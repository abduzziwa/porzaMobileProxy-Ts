# Deploying to k3s

## Apply order

```sh
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/configmap.yaml

# Real secrets — never committed. Copy the template, fill in real values
# from the current .env, apply directly:
cp k8s/secret.example.yaml k8s/secret.yaml
# edit k8s/secret.yaml with real values
kubectl apply -f k8s/secret.yaml

# RSA keypair as a file-mounted secret (not the templated secret.yaml above):
kubectl create secret generic porza-proxy-rsa-keys -n porza-proxy \
  --from-file=public.pem=./public.pem --from-file=private.pem=./private.pem

kubectl apply -f k8s/deployment.yaml
```

## Cutover from PM2 (same port, no nginx changes)

The Deployment uses `hostNetwork: true`, so the pod binds host port 3000
directly — nginx's existing `proxy_pass http://127.0.0.1:3000` needs no
changes at all. Sequence:

1. Apply everything above and confirm the pod is `Running` and `Ready`:
   `kubectl get pods -n porza-proxy -w`
2. Confirm it's actually listening: `curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/v3/orders/getPublicKey`
   — **this will fail while PM2 still holds port 3000** (only one process
   can bind a host port at a time). Stop PM2 first: `pm2 stop my-app-ts`,
   then retry.
3. Once the pod responds correctly, verify against `https://zagsdev.nl`
   directly (through nginx) to confirm the public-facing behavior is
   unchanged.
4. Only once confirmed stable: `pm2 delete my-app-ts` (or leave it stopped
   as a manual fallback for a while before fully removing it).

## Current limitation: 1 replica only

`hostNetwork: true` is what makes this byte-for-byte identical to PM2 from
nginx's point of view, but it also means only one pod can ever bind port
3000 on a given node — a second replica on the *same* node fails outright.
On this single-node cluster, that caps the app at `replicas: 1`; an HPA
isn't included yet because there's nothing for it to usefully scale.

Going beyond 1 replica needs one of:
- **Add another node** to the cluster — one replica per node still works
  with `hostNetwork`, since each node has its own port 3000.
- **Drop `hostNetwork`**, use a normal `Service` (ClusterIP or NodePort) and
  update nginx's `proxy_pass` to point at that Service's port instead —
  standard Kubernetes networking, but requires the nginx config edit that
  was deliberately avoided for this initial cutover.

## Logging

See `k8s/logging/` for the Loki/Promtail/Grafana setup — same namespace-
agnostic stack, deployed separately via Helm.
