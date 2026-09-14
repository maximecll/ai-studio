#!/bin/bash
cd "$(dirname "$0")" || exit 1
exec bash scripts/bootstrap.sh
