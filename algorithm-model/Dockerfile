ARG PYTHON_BASE_IMAGE=python:3.12-slim-bookworm
FROM ${PYTHON_BASE_IMAGE}

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    ULTRALYTICS_SETTINGS_DIR=/tmp/ultralytics

ARG PYTORCH_INDEX_URL=https://download.pytorch.org/whl/cu126

WORKDIR /model

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        libglib2.0-0 \
        libgomp1 \
    && rm -rf /var/lib/apt/lists/*

RUN python -m pip install --upgrade pip \
    && python -m pip install torch torchvision --index-url "${PYTORCH_INDEX_URL}"

COPY requirements.txt /model/requirements.txt
RUN python -m pip install -r /model/requirements.txt

COPY server.py verify_environment.py /model/

ENV MODEL_DEVICE=auto \
    MODEL_VERSION=trial-crack-missing-v1 \
    CRACK_MODEL_WEIGHTS_PATH=/models/wall_crack_yolo11x.pt \
    MISSING_MODEL_WEIGHTS_PATH=/models/missing.pt

EXPOSE 9002

CMD ["python", "-m", "uvicorn", "server:app", "--host", "0.0.0.0", "--port", "9002"]
