Run the Helm chart on a local kind cluster, with Redis and RabbitMQ next to it.

```bash
docker build -t autoflow-pro-backend:kind-test backend
kind create cluster --name afp-test
kind load docker-image autoflow-pro-backend:kind-test --name afp-test
kubectl create namespace autoflow
kubectl -n autoflow apply -f deploy/kind/dev-deps.yaml
kubectl -n autoflow create secret generic autoflow-secrets \
  --from-literal=SUPABASE_URL=http://supabase.invalid:54321 \
  --from-literal=SUPABASE_ANON_KEY=placeholder --from-literal=SUPABASE_SERVICE_KEY=placeholder \
  --from-literal=REDIS_URL=redis://redis:6379 --from-literal=RABBITMQ_URL=amqp://guest:guest@rabbitmq:5672
helm upgrade --install autoflow-pro deploy/helm/autoflow-pro -n autoflow -f deploy/kind/values-kind.yaml --wait
kubectl -n autoflow get pods
kind delete cluster --name afp-test      # when you are done
```

The Supabase values are placeholders, so the API starts and answers `/` but `/health` reports `degraded`. Point them at a real Supabase to run workflows. The captured run is in `docs/test-runs/2026-11-07-kind-cluster.txt`.
