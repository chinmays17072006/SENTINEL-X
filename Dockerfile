FROM python:3.12-slim-bookworm

ENV PORT=3000 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app
COPY --chown=65534:65534 server.py /app/server.py
COPY --chown=65534:65534 public/ /app/public/

USER 65534:65534
EXPOSE 3000
CMD ["python3", "/app/server.py"]
