# Build context: repository root
FROM python:3.12-slim
WORKDIR /srv
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt "uvicorn[standard]==0.34.0"
COPY backend/__init__.py backend/
COPY backend/app backend/app
COPY backend/data backend/data
EXPOSE 8000
CMD ["uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8000"]
