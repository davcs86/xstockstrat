FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY ../../packages/proto/gen/python /proto/gen/python
RUN pip install --no-cache-dir -e /proto/gen/python
COPY . .
EXPOSE 50056
EXPOSE 8056
CMD ["python", "-m", "app.main"]
