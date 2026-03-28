#!/bin/bash
set -e

# ── Idempotent first-run setup for ralph's home ────────────────────────────
# The bind mount overlays everything the build wrote to /home/ralph,
# so we bootstrap on first container start and skip on subsequent runs.

if [ ! -f "$HOME/.ralph-initialized" ]; then
    echo "ralph: first-run setup..."

    # Git identity
    git config --global user.name "Ralph Wiggum"
    git config --global user.email "ralph@ralph-wiggum"

    # ~/bin + ralph symlink
    mkdir -p ~/bin
    ln -sf /opt/ralph/ralph.mjs ~/bin/ralph
    chmod +x /opt/ralph/ralph.mjs 2>/dev/null || true

    # Oh My Zsh
    sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" "" --unattended

    # Configure zsh
    sed -i 's/^ZSH_THEME=.*/ZSH_THEME="agnoster"/' ~/.zshrc
    sed -i 's/^plugins=.*/plugins=(git node npm docker fzf)/' ~/.zshrc
    echo 'export PATH="$HOME/bin:/usr/local/bin:$PATH"' >> ~/.zshrc
    echo 'alias ll="ls -alF"' >> ~/.zshrc
    echo 'alias la="ls -A"' >> ~/.zshrc
    echo 'alias l="ls -CF"' >> ~/.zshrc

    touch "$HOME/.ralph-initialized"
    echo "ralph: setup complete."
fi

exec "$@"
