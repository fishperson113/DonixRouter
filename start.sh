docker stop donixrouter
docker rm donixrouter
docker build -t donixrouter .
docker run -d --name donixrouter -p 20128:20128 --env-file .env -v donixrouter-data:/app/data donixrouter