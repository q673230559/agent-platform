FROM mcr.microsoft.com/playwright/python:v1.61.0-jammy

# Use Tsinghua PyPI mirror (for China network)
RUN pip config set global.index-url https://pypi.tuna.tsinghua.edu.cn/simple && \
    pip config set global.trusted-host pypi.tuna.tsinghua.edu.cn

# ============================================
# Custom libraries and tools — add as needed
# ============================================

# System packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Python packages
RUN pip install --no-cache-dir \
    requests \
    pillow \
    pandas \
    openai \
    numpy \
    markdown \
    pyyaml \
    pygments \
    playwright

WORKDIR /workspace
