# Thermal artwork drawing service: Stable Diffusion 1.5 + ControlNet Lineart
# + LCM-LoRA, CPU only. Weights are pulled from Hugging Face into the /models
# volume on first start, so the image itself stays small.
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/models \
    HF_HUB_DISABLE_TELEMETRY=1 \
    TOKENIZERS_PARALLELISM=false

# Built with the repository root as context (the production deploy script
# insists every compose service builds from the same root), so paths are
# repo-relative.
WORKDIR /app
COPY server/artwork-service/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY server/artwork-service/app.py ./

VOLUME ["/models"]
EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
