FROM python:3.11-slim

WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils tesseract-ocr && rm -rf /var/lib/apt/lists/*
COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY backend ./backend
COPY alembic.ini ./alembic.ini

EXPOSE 8000
CMD ["sh", "-c", "alembic upgrade head && uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
