#!/usr/bin/env python3
"""
Ouvrier de génération d'images pour Studio.

Ollama ne sait pas faire de diffusion : ce processus prend le relais et pilote
mflux (l'implémentation MLX de FLUX, native Apple Silicon). Il est lancé par
`server/images.mjs`, reçoit sa tâche en JSON sur l'entrée standard, et rend
compte ligne par ligne en NDJSON — exactement comme Ollama pour ses
téléchargements, pour que l'interface n'ait qu'un seul motif à afficher.

Commandes : info · pull · generate

Discipline de sortie : la sortie standard ne transporte QUE du NDJSON. Les
bibliothèques tierces (tqdm, transformers, mflux) écrivent volontiers sur
stdout ; le descripteur 1 est donc redirigé vers stderr dès le démarrage et
un double privé est conservé pour nos propres lignes.
"""

import contextlib
import io
import json
import os
import re
import shutil
import signal
import sys
import threading
import time
from pathlib import Path

# ── Cloisonnement de la sortie ──────────────────────────────────────
# `encoding` explicite : os.fdopen suit sinon l'encodage local, qui vaut
# cp1252 sous Windows. PYTHONIOENCODING ne couvre que sys.stdout, pas un
# flux ouvert après coup — les accents en ressortaient illisibles.
_CHANNEL = os.fdopen(os.dup(1), "w", buffering=1, encoding="utf-8", errors="replace")
os.dup2(2, 1)
sys.stdout = sys.stderr
for _flux in (sys.stdout, sys.stderr):
    with contextlib.suppress(Exception):
        _flux.reconfigure(encoding="utf-8", errors="replace")

_lock = threading.Lock()


def emit(**event) -> None:
    """Une ligne JSON, atomique — plusieurs fils peuvent écrire."""
    with _lock:
        _CHANNEL.write(json.dumps(event, ensure_ascii=False) + "\n")
        _CHANNEL.flush()


def fail(message: str, kind: str = "error") -> None:
    emit(type="error", kind=kind, message=message)
    sys.exit(1)


# ── Arrêt demandé ───────────────────────────────────────────────────
_stop = threading.Event()


def _on_signal(signum, frame):  # noqa: ARG001
    _stop.set()


signal.signal(signal.SIGTERM, _on_signal)
signal.signal(signal.SIGINT, _on_signal)


# ── Cache Hugging Face ──────────────────────────────────────────────

def cache_root() -> Path:
    from huggingface_hub.constants import HF_HUB_CACHE

    return Path(HF_HUB_CACHE)


def repo_dir(repo: str) -> Path:
    return cache_root() / ("models--" + repo.replace("/", "--"))


def dir_size(path: Path) -> int:
    """Octets réellement posés sur le disque, fichiers partiels compris.

    `snapshots/` n'est qu'une arborescence de liens vers `blobs/` : suivre ces
    liens compterait chaque poids deux fois et ferait grimper la progression
    au double de la réalité. On lit donc le lien, pas sa cible.
    """
    if not path.exists():
        return 0
    total = 0
    for root, _dirs, files in os.walk(path, followlinks=False):
        for name in files:
            try:
                total += (Path(root) / name).lstat().st_size
            except OSError:
                pass
    return total


def xet_cache() -> Path:
    """Cache de morceaux de Xet — un second dépôt, à part des poids.

    huggingface_hub télécharge par morceaux dédupliqués et les conserve ici.
    Le disque paie donc deux fois : une fois le cache, une fois les poids
    reconstitués. L'interface doit pouvoir le dire, et le vider.
    """
    home = os.environ.get("HF_HOME")
    root = Path(home) if home else Path.home() / ".cache" / "huggingface"
    return root / "xet"


def partial_state(path: Path) -> dict:
    """Ce que les fichiers `.incomplete` disent d'un téléchargement.

    huggingface_hub écrit d'abord des fichiers partiels, puis les renomme. Leur
    présence signale donc un transfert commencé ; leur date de modification dit
    s'il progresse encore ou s'il a été interrompu. C'est ce qui permet à
    l'application de retrouver un téléchargement qu'elle n'a pas lancé —
    après un redémarrage, par exemple.
    """
    if not path.exists():
        return {"partials": 0, "fresh": False}
    newest = 0.0
    count = 0
    for root, _dirs, files in os.walk(path, followlinks=False):
        for name in files:
            if not name.endswith(".incomplete"):
                continue
            count += 1
            try:
                newest = max(newest, (Path(root) / name).lstat().st_mtime)
            except OSError:
                pass
    return {"partials": count, "fresh": bool(count) and (time.time() - newest) < 30}


def _kept(path: str, subfolder, allow, ignore) -> bool:
    from fnmatch import fnmatch

    if subfolder and not path.startswith(subfolder + "/"):
        return False
    if ignore and any(fnmatch(path, motif) for motif in ignore):
        return False
    if allow and not any(fnmatch(path, motif) for motif in allow):
        return False
    return True


def repo_weight(repo: str, subfolder: str | None = None, allow=None, ignore=None) -> int:
    """Poids de ce qu'on va réellement chercher, en octets.

    Certains dépôts publient plusieurs quantifications côte à côte : le dépôt
    de Wan2.2 A14B pèse 209 Go pour 28 Go utiles. Compter le tout ferait
    afficher une progression absurde.
    """
    from huggingface_hub import HfApi

    total = 0
    for entry in HfApi().list_repo_tree(repo, recursive=True):
        if not _kept(str(getattr(entry, "path", "")), subfolder, allow, ignore):
            continue
        size = getattr(entry, "size", None)
        lfs = getattr(entry, "lfs", None)
        if lfs is not None and getattr(lfs, "size", None):
            total += lfs.size
        elif size:
            total += size
    return total


# ── info ────────────────────────────────────────────────────────────

def _backend() -> tuple[str | None, str]:
    """Moteur réellement installé dans cet environnement.

    mflux ne s'installe que sur puce Apple ; ailleurs c'est diffusers qui
    porte la diffusion. Un seul des deux est présent à la fois.
    """
    from importlib.metadata import version

    for module, name in (("mflux", "mflux"), ("diffusers", "diffusers")):
        try:
            __import__(module)
            return name, version(name)
        except Exception:
            continue
    return None, "?"


def _cuda() -> dict | None:
    """Carte visible par torch — absente sur le chemin mflux."""
    try:
        import torch
    except Exception:
        return None
    try:
        if torch.cuda.is_available():
            props = torch.cuda.get_device_properties(0)
            return {"device": "cuda", "name": props.name, "vram": int(props.total_memory)}
        if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
            return {"device": "mps", "name": "Apple GPU", "vram": 0}
    except Exception:
        pass
    return {"device": "cpu", "name": None, "vram": 0}


def cmd_info(job: dict) -> None:
    backend, engine_version = _backend()
    if backend is None:
        fail("Aucun moteur d'images installé dans cet environnement.", kind="engine")
        return

    cached = []
    for repo in job.get("repos", []):
        d = repo_dir(repo)
        state = partial_state(d)
        cached.append({
            "repo": repo,
            # Un dépôt encore incomplet n'est pas installé, quoi qu'il pèse.
            "present": d.exists() and state["partials"] == 0,
            "bytes": dir_size(d),
            "partials": state["partials"],
            "downloading": state["fresh"],
        })

    usage = shutil.disk_usage(str(cache_root().parent if cache_root().exists() else Path.home()))
    emit(
        type="info",
        backend=backend,
        # `mflux` reste renseigné : c'est la version du moteur, quel qu'il soit.
        mflux=engine_version,
        torch=_cuda() if backend == "diffusers" else None,
        python=sys.version.split()[0],
        cache=str(cache_root()),
        free=usage.free,
        xet=dir_size(xet_cache()),
        repos=cached,
    )


# ── pull ────────────────────────────────────────────────────────────

def cmd_pull(job: dict) -> None:
    from huggingface_hub import snapshot_download

    repo = job["repo"]
    subfolder = job.get("subfolder")
    allow = job.get("allow")
    ignore = job.get("ignore")
    target = repo_dir(repo)

    emit(type="phase", phase="manifest", label="Lecture du dépôt")
    try:
        total = repo_weight(repo, subfolder, allow, ignore)
    except Exception as exc:
        fail(f"Dépôt illisible : {exc}", kind="repo")
        return

    started = time.monotonic()
    base = dir_size(target)

    def watch() -> None:
        """Progression lue sur le disque : indépendante du transport employé.

        huggingface_hub a plusieurs chemins de téléchargement (xet, hf_transfer,
        HTTP simple) qui ne rapportent pas tous de la même façon. Le volume posé
        sur le disque, lui, est vrai dans tous les cas.
        """
        speed = 0.0
        last_at = time.monotonic()
        last_bytes = base
        while not _stop.is_set() and not _done.is_set():
            time.sleep(0.6)
            now = time.monotonic()
            current = dir_size(target)
            dt = now - last_at
            if dt > 0:
                instant = max(0.0, current - last_bytes) / dt
                # Lissage exponentiel : une estimation stable vaut mieux qu'exacte.
                speed = instant if speed == 0 else speed * 0.7 + instant * 0.3
                last_at, last_bytes = now, current
            remaining = max(0, total - current)
            emit(
                type="progress",
                phase="downloading",
                completed=current,
                total=total,
                speed=speed,
                eta=(remaining / speed) if speed > 1 else None,
            )

    _done = threading.Event()
    thread = threading.Thread(target=watch, daemon=True)
    thread.start()

    error: list[BaseException] = []

    def run() -> None:
        try:
            snapshot_download(
                repo_id=repo,
                max_workers=4,
                # Un dépôt qui publie plusieurs quantifications, ou des poids
                # dans trois formats : on ne prend que ce qui servira.
                allow_patterns=([f"{subfolder}/*"] if subfolder else None) or allow,
                ignore_patterns=ignore,
            )
        except BaseException as exc:  # noqa: BLE001 — remonté tel quel
            error.append(exc)
        finally:
            _done.set()

    worker = threading.Thread(target=run, daemon=True)
    worker.start()
    # L'attente reste interruptible : un SIGTERM ne doit pas être retenu
    # jusqu'à la fin d'un téléchargement de plusieurs gigaoctets.
    while worker.is_alive():
        if _stop.is_set():
            emit(type="cancelled")
            os._exit(0)
        worker.join(0.3)
    _done.set()

    if error:
        fail(f"Téléchargement interrompu : {error[0]}", kind="download")
        return

    emit(
        type="done",
        bytes=dir_size(target),
        ms=int((time.monotonic() - started) * 1000),
    )


# ── generate ────────────────────────────────────────────────────────

class Reporter:
    """Rapporteur branché sur la boucle de débruitage de mflux.

    mflux appelle `call_in_loop` à chaque pas ; `call_interrupt` lui permet
    d'abandonner proprement, ce qui laisse MLX libérer sa mémoire au lieu
    d'être tué net.
    """

    def __init__(self, steps: int):
        self.steps = steps
        self.started = time.monotonic()
        self.last = self.started

    def call_before_loop(self, seed, prompt, latents, config, **kwargs):  # noqa: ARG002
        emit(type="phase", phase="diffusing", label="Débruitage", steps=self.steps)

    def call_in_loop(self, t, seed, prompt, latents, config, time_steps):  # noqa: ARG002
        if _stop.is_set():
            from mflux.utils.exceptions import StopImageGenerationException

            raise StopImageGenerationException("Génération annulée.")
        now = time.monotonic()
        step = int(t) + 1
        emit(
            type="step",
            step=step,
            steps=self.steps,
            # Durée du pas : de quoi estimer la fin sans deviner.
            stepMs=int((now - self.last) * 1000),
            elapsedMs=int((now - self.started) * 1000),
        )
        self.last = now

    def call_interrupt(self, t, seed, prompt, latents, config, time_steps):  # noqa: ARG002
        emit(type="cancelled")


# « ✅ Applied to 494 layers (912/1128 keys matched) »
APPLIED = re.compile(r"Applied to (\d+) layers \((\d+)/(\d+) keys matched\)")


def _announce_loras(output: str, loras: list) -> None:
    """Compte rendu de l'application des adaptateurs.

    Un fichier entraîné pour une autre architecture se charge sans erreur et
    n'adapte aucune couche : l'image sort alors identique à celle du modèle nu,
    sans que rien ne l'ait signalé. C'est précisément ce qu'il faut dire.
    """
    if not loras:
        return
    for lora, m in zip(loras, APPLIED.finditer(output)):
        layers, matched, total = (int(g) for g in m.groups())
        emit(
            type="lora",
            file=os.path.basename(lora["path"]),
            scale=float(lora.get("scale", 1.0)),
            layers=layers,
            matched=matched,
            total=total,
        )
    # Aucune ligne de compte rendu : rien n'a été appliqué.
    if not APPLIED.search(output):
        emit(type="lora", file=os.path.basename(loras[0]["path"]), layers=0, matched=0, total=0)


# Chaque famille a sa classe, mais toutes partagent le même constructeur
# (quantize, model_path, lora_paths, lora_scales, bake_lora, model_config) et la
# même signature de génération. Le worker n'a donc qu'à choisir la bonne porte.
FAMILIES = {
    "flux": ("mflux.models.flux.variants.txt2img.flux", "Flux1"),
    "flux2": ("mflux.models.flux2.variants.txt2img.flux2_klein", "Flux2Klein"),
    "z-image": ("mflux.models.z_image.variants.z_image", "ZImage"),
    "krea2": ("mflux.models.krea2.variants.txt2img.krea2", "Krea2"),
}


def _model_class(family: str):
    import importlib

    entry = FAMILIES.get(family)
    if entry is None:
        raise ValueError(f"Famille inconnue : {family}")
    module, name = entry
    return getattr(importlib.import_module(module), name)


def _save(image, out: Path) -> None:
    """Les familles ne rendent pas toutes le même objet.

    FLUX rend un `GeneratedImage`, qui sait s'écrire avec ses métadonnées ;
    Z-Image rend une image PIL nue, dont `save` a une autre signature.
    """
    out.parent.mkdir(parents=True, exist_ok=True)
    try:
        image.save(path=str(out), overwrite=True)
    except TypeError:
        image.save(str(out))


# ── Wan, par mlx-video ───────────────────────────────────────────────

# « Diffusion:  17%|█▋        | 1/6 [00:06<00:32,  6.58s/it] »
TQDM_STEP = re.compile(r"\|\s*(\d+)\s*/\s*(\d+)\s*\[")
# « ✓ Applied to 320 modules » / « ⚠ Skipped 480 incompatible modules »
WAN_APPLIED = re.compile(r"Applied to (\d+) modules")
WAN_SKIPPED = re.compile(r"Skipped (\d+) incompatible modules")


class ProgressTap:
    """Écoute la barre de progression de mlx-video pour en tirer des pas.

    mlx-video n'offre pas de rappel : il écrit une barre tqdm sur la sortie
    d'erreur. On s'intercale donc sur ce flux — sans rien retenir, tout continue
    d'aller au journal — et on traduit ce qui ressemble à un pas.
    """

    def __init__(self, stream, steps: int):
        self._stream = stream
        self._steps = steps
        self._seen = 0
        self._started = time.monotonic()
        self._last = self._started
        # Compte rendu des adaptateurs, agrégé sur tous les fichiers.
        self.applied = 0
        self.skipped = 0

    def write(self, text: str) -> int:
        n = self._stream.write(text)
        for m in WAN_APPLIED.finditer(text):
            self.applied += int(m.group(1))
        for m in WAN_SKIPPED.finditer(text):
            self.skipped += int(m.group(1))
        for m in TQDM_STEP.finditer(text):
            step, total = int(m.group(1)), int(m.group(2))
            if step <= self._seen or step > total:
                continue
            now = time.monotonic()
            if self._seen == 0:
                # Le tampon est posé avant l'encodage du texte, qui dure deux
                # minutes. Sans cette remise à zéro, le premier pas porterait
                # tout ce temps et l'estimation de la fin partirait en vrille.
                self._started = self._last = now
            self._seen = step
            emit(
                type="step", step=step, steps=total,
                stepMs=int((now - self._last) * 1000),
                elapsedMs=int((now - self._started) * 1000),
            )
            self._last = now
        return n

    def __getattr__(self, name):
        return getattr(self._stream, name)


def _wan_model_dir(repo: str, subfolder: str | None = None) -> str:
    """Dossier local des poids, sans jamais aller sur le réseau.

    `snapshot_download(local_files_only=True)` refuse un instantané incomplet —
    et le nôtre l'est délibérément : d'un dépôt qui publie plusieurs
    quantifications, on ne récupère que la sienne. On lit donc directement la
    disposition du cache, qui est stable : `refs/main` porte la révision, et
    `snapshots/<révision>` le contenu.
    """
    root = repo_dir(repo)
    ref = root / "refs" / "main"
    snapshots = root / "snapshots"

    target = None
    if ref.is_file():
        candidate = snapshots / ref.read_text().strip()
        if candidate.is_dir():
            target = candidate
    if target is None and snapshots.is_dir():
        # Pas de référence lisible : on prend l'instantané le plus récent.
        dirs = sorted((d for d in snapshots.iterdir() if d.is_dir()), key=lambda d: d.stat().st_mtime)
        target = dirs[-1] if dirs else None

    if target is None:
        raise FileNotFoundError(f"aucun instantané local pour {repo}")

    full = target / subfolder if subfolder else target
    if not full.is_dir():
        raise FileNotFoundError(f"dossier absent : {full}")
    return str(full)


def _first_frame(video: Path, out: Path) -> None:
    """Une image fixe est une vidéo d'une image : on en extrait la première."""
    import imageio.v3 as iio
    import numpy as np

    frames = np.asarray(iio.imread(str(video), plugin="FFMPEG"))
    out.parent.mkdir(parents=True, exist_ok=True)
    iio.imwrite(str(out), frames[0] if frames.ndim == 4 else frames)


def _generate_wan(job: dict) -> None:
    from mlx_video.models.wan_2.generate import generate_video

    steps = int(job.get("steps", 20))
    out = Path(job["output"])
    loras = job.get("loras") or []
    started = time.monotonic()

    emit(type="phase", phase="loading", label="Chargement du modèle", loras=len(loras))
    try:
        model_dir = _wan_model_dir(job["repo"], job.get("subfolder"))
    except Exception as exc:
        fail(f"Poids introuvables en local : {exc}", kind="load")
        return

    if _stop.is_set():
        emit(type="cancelled")
        return

    # Wan encode la description avec UMT5-XXL, onze milliards de paramètres
    # chargés puis relâchés. C'est le poste le plus coûteux, et il précède
    # entièrement le débruitage : autant le dire pendant qu'il dure.
    emit(type="phase", phase="encoding", label="Encodage de la description")

    """
    Routage des adaptateurs.

    Sur un modèle à double expert, un LoRA entraîné pour le bruit élevé n'a
    rien à faire dans le transformeur du bruit faible : ses corrections y
    seraient appliquées à contretemps. Chaque fichier part donc vers l'expert
    qu'il vise, et seuls ceux qui ne le déclarent pas vont aux deux.
    """
    pairs = [[l["path"], float(l.get("scale", 1.0))] for l in loras]
    high = [p for p, l in zip(pairs, loras) if l.get("expert") == "high"]
    low = [p for p, l in zip(pairs, loras) if l.get("expert") == "low"]
    both = [p for p, l in zip(pairs, loras) if l.get("expert") not in ("high", "low")]

    video = out.with_suffix(".mp4")
    tap = ProgressTap(sys.stderr, steps)
    # `print` écrit sur la sortie standard, elle-même redirigée vers la sortie
    # d'erreur au démarrage : les deux doivent traverser le tampon, sinon le
    # compte rendu des LoRAs lui échapperait.
    prev_err, prev_out = sys.stderr, sys.stdout
    sys.stderr = sys.stdout = tap
    try:
        generate_video(
            model_dir=model_dir,
            prompt=job["prompt"],
            width=int(job.get("width", 1024)),
            height=int(job.get("height", 1024)),
            # Une seule image : la contrainte 4n+1 est satisfaite par n = 0.
            num_frames=1,
            steps=steps,
            guide_scale=float(job.get("guidance", 5)),
            seed=int(job["seed"]),
            output_path=str(video),
            loras=both or None,
            loras_high=high or None,
            loras_low=low or None,
            tiling=job.get("tiling", "auto"),
        )
    except Exception as exc:
        fail(f"Génération impossible : {exc}", kind="generate")
        return
    finally:
        sys.stderr, sys.stdout = prev_err, prev_out

    if loras:
        # Un LoRA entraîné pour le modèle à 14 milliards ne correspond à aucune
        # couche du 5 milliards : mlx-video les ignore en le signalant à peine.
        emit(
            type="lora",
            file=os.path.basename(loras[0]["path"]),
            scale=float(loras[0].get("scale", 1.0)),
            layers=tap.applied,
            matched=tap.applied,
            total=tap.applied + tap.skipped,
        )

    if _stop.is_set():
        emit(type="cancelled")
        return

    emit(type="phase", phase="decoding", label="Extraction de l’image")
    try:
        _first_frame(video, out)
    finally:
        video.unlink(missing_ok=True)

    emit(
        type="done",
        path=str(out),
        bytes=out.stat().st_size if out.exists() else 0,
        ms=int((time.monotonic() - started) * 1000),
        peak=None,
    )


class _Cancelled(Exception):
    """Sortie propre de la boucle de débruitage de diffusers."""


def _torch_target():
    """Appareil et précision : CUDA si présent, sinon MPS, sinon le processeur."""
    import torch

    if torch.cuda.is_available():
        return "cuda", torch.float16
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps", torch.float16
    # Le fp16 n'est pas implémenté pour tous les noyaux CPU.
    return "cpu", torch.float32


def _generate_diffusers(job: dict) -> None:
    """Chemin PyTorch — Windows, Linux, et tout ce qui n'est pas Apple."""
    import torch
    from diffusers import AutoPipelineForText2Image

    steps = int(job.get("steps", 20))
    started = time.monotonic()
    device, dtype = _torch_target()

    emit(type="phase", phase="loading", label="Chargement du modèle", loras=0)
    try:
        pipe = AutoPipelineForText2Image.from_pretrained(
            job["repo"],
            torch_dtype=dtype,
            # Le dépôt publie souvent les mêmes poids en plusieurs formats ;
            # seul le nôtre a été téléchargé, diffusers prendra celui-là.
            variant=job.get("variant") or None,
        )
    except Exception as exc:
        fail(f"Chargement impossible : {exc}", kind="load")
        return

    """
    Discipline mémoire.

    `enable_model_cpu_offload` ne garde sur le GPU que le sous-modèle en cours :
    encodeurs de texte, transformeur puis VAE se relaient au lieu de cohabiter.
    C'est ce qui fait tenir SDXL sur 8 Go de VRAM. Le découpage de l'attention
    et le décodage du VAE par tuiles écrêtent les deux autres pics.
    """
    try:
        if device == "cuda":
            pipe.enable_model_cpu_offload()
        else:
            pipe.to(device)
    except Exception:
        pipe.to("cpu")
    for reglage in ("enable_attention_slicing", "enable_vae_slicing", "enable_vae_tiling"):
        with contextlib.suppress(Exception):
            getattr(pipe, reglage)()

    if _stop.is_set():
        emit(type="cancelled")
        return

    emit(type="phase", phase="diffusing", label="Débruitage", steps=steps)
    horloge = {"debut": time.monotonic(), "dernier": time.monotonic()}

    def au_pas(_pipe, step, _timestep, kwargs):
        if _stop.is_set():
            raise _Cancelled
        maintenant = time.monotonic()
        emit(
            type="step",
            # Certains ordonnanceurs produisent un pas de plus que demandé :
            # la barre de progression ne doit pas dépasser son total.
            step=min(int(step) + 1, steps),
            steps=steps,
            stepMs=int((maintenant - horloge["dernier"]) * 1000),
            elapsedMs=int((maintenant - horloge["debut"]) * 1000),
        )
        horloge["dernier"] = maintenant
        return kwargs

    # Une graine sur le processeur donne le même résultat quel que soit l'appareil.
    appel = {
        "prompt": job["prompt"],
        "num_inference_steps": steps,
        "height": int(job.get("height", 1024)),
        "width": int(job.get("width", 1024)),
        "generator": torch.Generator(device="cpu").manual_seed(int(job["seed"])),
        "callback_on_step_end": au_pas,
    }
    if job.get("guidance") is not None:
        appel["guidance_scale"] = float(job["guidance"])

    try:
        image = pipe(**appel).images[0]
    except _Cancelled:
        emit(type="cancelled")
        return
    except Exception as exc:
        fail(f"Génération impossible : {exc}", kind="generate")
        return

    out = Path(job["output"])
    try:
        out.parent.mkdir(parents=True, exist_ok=True)
        image.save(out)
    except Exception as exc:
        fail(f"Écriture impossible : {exc}", kind="save")
        return

    peak = None
    with contextlib.suppress(Exception):
        if device == "cuda":
            peak = int(torch.cuda.max_memory_allocated())

    emit(
        type="done",
        path=str(out),
        bytes=out.stat().st_size if out.exists() else 0,
        ms=int((time.monotonic() - started) * 1000),
        peak=peak,
    )


def cmd_generate(job: dict) -> None:
    # Wan ne passe pas par mflux : moteur distinct, chemin distinct.
    if job.get("runner") == "mlx-video":
        return _generate_wan(job)
    if job.get("runner") == "diffusers":
        return _generate_diffusers(job)

    from mflux.callbacks.instances.memory_saver import MemorySaver
    from mflux.models.common.config import ModelConfig
    from mflux.utils.exceptions import StopImageGenerationException

    repo = job["repo"]
    base = job.get("base")
    steps = int(job.get("steps", 4))
    started = time.monotonic()

    """
    LoRAs.

    `bake_lora` fond l'adaptateur dans les poids de base. Sur un modèle déjà
    quantifié en 4 bits, mflux doit alors déquantifier, fusionner, puis
    requantifier en 8 bits les couches touchées — un delta de rang faible passe
    sous le pas de quantification d'un q4 et disparaîtrait sinon. La mémoire
    grimpe d'autant, ce qui ne pardonne pas sur 16 Go.
    
    Sans fusion, l'adaptateur reste une couche séparée appliquée à l'exécution :
    la base demeure en 4 bits, le coût mémoire est celui du LoRA seul.
    """
    loras = job.get("loras") or []
    lora_paths = [l["path"] for l in loras] or None
    lora_scales = [float(l.get("scale", 1.0)) for l in loras] or None
    bake = bool(job.get("bakeLora", False))

    emit(
        type="phase", phase="loading", label="Chargement du modèle",
        loras=len(loras),
    )
    # mflux raconte l'application des LoRAs sur sa sortie standard. On la
    # détourne le temps du chargement pour en tirer un compte rendu utilisable,
    # puis on la restitue au journal.
    report = io.StringIO()
    try:
        # `base` décrit l'architecture ; `repo` peut être une redistribution
        # déjà quantifiée, auquel cas rien n'est à quantifier au chargement.
        config = ModelConfig.from_name(model_name=repo, base_model=base)
        Model = _model_class(job.get("family", "flux"))
        with contextlib.redirect_stdout(report):
            flux = Model(
                model_config=config,
                quantize=job.get("quantize"),
                lora_paths=lora_paths,
                lora_scales=lora_scales,
                bake_lora=bake,
            )
    except Exception as exc:
        sys.stderr.write(report.getvalue())
        fail(f"Chargement impossible : {exc}", kind="load")
        return

    sys.stderr.write(report.getvalue())
    _announce_loras(report.getvalue(), loras)

    if _stop.is_set():
        emit(type="cancelled")
        return

    """
    Discipline mémoire — déterminante sur une machine à 16 Go.

    Sans ce gardien, les encodeurs de texte (CLIP et surtout T5) restent
    résidents pendant toute la boucle de débruitage alors qu'ils ont fini leur
    travail dès l'encodage de la description : huit à douze gigaoctets retenus
    pour rien, que le système part alors chercher sur le SSD à chaque pas.

    `keep_transformer=False` libère aussi le transformeur une fois la boucle
    finie, et le plafond de cache MLX déclenche le décodage du VAE par tuiles,
    qui écrête le pic de fin de génération.
    """
    saver = MemorySaver(
        model=flux,
        keep_transformer=False,
        cache_limit_bytes=(1000**3) if job.get("lowRam", True) else None,
        num_seeds=1,
    )
    flux.callbacks.register(saver)
    flux.callbacks.register(Reporter(steps))

    try:
        image = flux.generate_image(
            seed=int(job["seed"]),
            prompt=job["prompt"],
            num_inference_steps=steps,
            height=int(job.get("height", 1024)),
            width=int(job.get("width", 1024)),
            guidance=float(job.get("guidance", 3.5)),
        )
    except StopImageGenerationException:
        emit(type="cancelled")
        return
    except Exception as exc:
        fail(f"Génération impossible : {exc}", kind="generate")
        return

    out = Path(job["output"])
    try:
        _save(image, out)
    except Exception as exc:
        fail(f"Écriture impossible : {exc}", kind="save")
        return

    peak = None
    try:
        peak = int(saver.peak_memory)
    except Exception:
        pass

    emit(
        type="done",
        path=str(out),
        bytes=out.stat().st_size if out.exists() else 0,
        ms=int((time.monotonic() - started) * 1000),
        peak=peak,
    )


COMMANDS = {"info": cmd_info, "pull": cmd_pull, "generate": cmd_generate}


def main() -> None:
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        fail(f"Commande attendue parmi {', '.join(COMMANDS)}.", kind="usage")
        return
    raw = sys.stdin.read()
    try:
        job = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as exc:
        fail(f"Tâche illisible : {exc}", kind="usage")
        return
    COMMANDS[sys.argv[1]](job)


if __name__ == "__main__":
    main()
