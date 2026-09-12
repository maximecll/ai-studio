import { memo, useState, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { Check, Copy } from 'lucide-react'
import { motion } from 'framer-motion'
import { cn } from '../../lib/utils'

function toText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(toText).join('')
  const el = node as { props?: { children?: ReactNode } }
  return el.props ? toText(el.props.children) : ''
}

const LANGS: Record<string, string> = {
  js: 'JavaScript', jsx: 'JSX', ts: 'TypeScript', tsx: 'TSX', py: 'Python', python: 'Python',
  sh: 'Shell', bash: 'Bash', zsh: 'Zsh', json: 'JSON', yaml: 'YAML', yml: 'YAML',
  html: 'HTML', css: 'CSS', sql: 'SQL', go: 'Go', rs: 'Rust', rust: 'Rust', md: 'Markdown',
  c: 'C', cpp: 'C++', java: 'Java', php: 'PHP', rb: 'Ruby', swift: 'Swift', kotlin: 'Kotlin',
  diff: 'Diff', xml: 'XML', toml: 'TOML', ini: 'INI', dockerfile: 'Dockerfile',
}

function CodeBlock({ lang, code, children }: { lang?: string; code: string; children: ReactNode }) {
  const [copied, setCopied] = useState(false)
  const lines = code.replace(/\n$/, '').split('\n').length

  return (
    <figure className="group/code my-4 overflow-hidden rounded-sm border border-line bg-surface-2">
      <figcaption className="flex h-9 items-center justify-between border-b border-line px-3">
        <span className="flex items-center gap-2">
          <span className="font-mono text-[11px] font-bold tracking-wide text-fg-muted">
            {lang ? (LANGS[lang] ?? lang) : 'texte'}
          </span>
          <span className="font-mono text-[11px] text-fg-subtle">
            {lines} ligne{lines > 1 ? 's' : ''}
          </span>
        </span>
        <motion.button
          whileTap={{ scale: 0.94 }}
          onClick={async () => {
            await navigator.clipboard.writeText(code)
            setCopied(true)
            setTimeout(() => setCopied(false), 1600)
          }}
          className={cn(
            'flex h-6 cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-[11px] font-medium',
            'transition-all duration-150 opacity-0 group-hover/code:opacity-100 focus-visible:opacity-100',
            copied ? 'text-positive opacity-100!' : 'text-fg-muted hover:bg-fg/[0.07] hover:text-fg',
          )}
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? 'Copié' : 'Copier'}
        </motion.button>
      </figcaption>
      <pre className="overflow-x-auto scroll-thin p-3.5">{children}</pre>
    </figure>
  )
}

const components: Components = {
  pre({ children }) {
    const child = (Array.isArray(children) ? children[0] : children) as
      { props?: { className?: string; children?: ReactNode } } | undefined
    const cls = child?.props?.className ?? ''
    const lang = /language-([\w+#-]+)/.exec(cls)?.[1]
    return <CodeBlock lang={lang} code={toText(child?.props?.children)}>{children}</CodeBlock>
  },
  a({ children, href }) {
    return <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>
  },
  table({ children }) {
    return (
      <div className="my-4 overflow-x-auto scroll-thin rounded-sm border border-line">
        <table>{children}</table>
      </div>
    )
  },
}

export const Markdown = memo(function Markdown({ children }: { children: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={components}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
})
