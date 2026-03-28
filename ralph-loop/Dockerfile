FROM debian:bookworm-slim

ARG NODE_MAJOR=24
ARG GO_VERSION=1.26.1
ARG USERNAME=ralph
ARG USER_UID=1000
ARG USER_GID=1000

# Prevent interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# ── System packages ──────────────────────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Build essentials
    build-essential \
    cmake \
    pkg-config \
    autoconf \
    automake \
    libtool \
    # Python 3
    python3 \
    python3-pip \
    python3-venv \
    python3-dev \
    # Version control
    git \
    git-lfs \
    # Network & download
    curl \
    wget \
    ca-certificates \
    gnupg \
    openssh-client \
    # Editors
    vim \
    neovim \
    nano \
    # Terminal multiplexer
    tmux \
    screen \
    # File discovery & exploration
    tree \
    fd-find \
    fzf \
    ripgrep \
    silversearcher-ag \
    mlocate \
    file \
    pv \
    # Text processing
    sed \
    gawk \
    jq \
    yq \
    # Process & system monitoring
    htop \
    procps \
    lsof \
    strace \
    # Archive & compression
    zip \
    unzip \
    tar \
    gzip \
    bzip2 \
    xz-utils \
    zstd \
    # Networking tools
    dnsutils \
    iputils-ping \
    net-tools \
    netcat-openbsd \
    socat \
    # Misc utilities
    less \
    bat \
    entr \
    watch \
    direnv \
    sudo \
    locales \
    # Shell
    zsh \
    && rm -rf /var/lib/apt/lists/*

# ── Locale setup ─────────────────────────────────────────────────────────────
RUN sed -i 's/# en_US.UTF-8/en_US.UTF-8/' /etc/locale.gen && locale-gen
ENV LANG=en_US.UTF-8
ENV LC_ALL=en_US.UTF-8

# ── Node.js 24 ───────────────────────────────────────────────────────────────
RUN curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

# ── Global npm packages ─────────────────────────────────────────────────────
RUN npm install -g \
    zx \
    opencode-ai

# ── Claude Code (native installer) ─────────────────────────────────────────
RUN curl -fsSL https://claude.ai/install.sh | bash && \
    ln -sf /root/.local/bin/claude /usr/local/bin/claude

# ── Tessl ──────────────────────────────────────────────────────────────────
RUN curl -fsSL https://get.tessl.io | sh && \
    ln -sf /root/.local/bin/tessl /usr/local/bin/tessl

# ── Go ─────────────────────────────────────────────────────────────────────────
RUN curl -fsSL https://go.dev/dl/go${GO_VERSION}.linux-$(dpkg --print-architecture).tar.gz | tar -C /usr/local -xz
ENV PATH="/usr/local/go/bin:${PATH}"

# ── Rust ───────────────────────────────────────────────────────────────────────
ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo
RUN curl -fsSL https://sh.rustup.rs | sh -s -- -y --no-modify-path && \
    chmod -R a+rw ${CARGO_HOME} ${RUSTUP_HOME}
ENV PATH="/usr/local/cargo/bin:${PATH}"

# ── Ruby ───────────────────────────────────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    ruby-full \
    && rm -rf /var/lib/apt/lists/*

# ── Symlink fd (Debian names it fdfind) ──────────────────────────────────────
RUN ln -sf /usr/bin/fdfind /usr/local/bin/fd

# ── Symlink bat (Debian names it batcat) ─────────────────────────────────────
RUN ln -sf /usr/bin/batcat /usr/local/bin/bat

# ── Create user ralph with sudo ──────────────────────────────────────────────
RUN groupadd --gid ${USER_GID} ${USERNAME} && \
    useradd --uid ${USER_UID} --gid ${USER_GID} -m -s /bin/zsh ${USERNAME} && \
    echo "${USERNAME} ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/${USERNAME} && \
    chmod 0440 /etc/sudoers.d/${USERNAME}

# ── Entrypoint (bootstraps home dir on first run) ───────────────────────────
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

USER ${USERNAME}
WORKDIR /home/${USERNAME}

ENTRYPOINT ["entrypoint.sh"]
CMD ["sleep", "infinity"]
