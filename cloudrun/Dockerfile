FROM python:3.11-slim

WORKDIR /app
COPY cloudrun/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY cloudrun/main.py /app/main.py

ENV PYTHONUNBUFFERED=1
CMD ["python", "/app/main.py"]
