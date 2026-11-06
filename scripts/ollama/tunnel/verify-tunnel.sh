#!/usr/bin/env bash
# Read-only check to run on an approved Linux VPS after the tunnel is provisioned.
set -euo pipefail
if [[ $# -ne 3 ]]; then
  printf 'Usage: %s SERVER_CA CLIENT_CERT CLIENT_KEY\n' "$0" >&2
  exit 2
fi
for file in "$@"; do
  [[ -f "$file" && -r "$file" ]] || { echo 'TLS material is missing or unreadable' >&2; exit 2; }
done
port=21144
hostname=navi-inference.internal
url="https://$hostname:$port/api/version"
listeners="$(ss -H -ltn "sport = :$port" | awk '{ print $4 }')"
[[ "$listeners" == "127.0.0.1:$port" ]] || { echo 'Expected exactly one IPv4 loopback listener' >&2; exit 1; }

tls=(--disable --noproxy '*' --proto '=https' --connect-timeout 3 --max-time 6 --max-filesize 16384
     --silent --show-error --cacert "$1" --resolve "$hostname:$port:127.0.0.1")
if status="$(curl "${tls[@]}" --output /dev/null --write-out '%{http_code}' "$url" 2>/dev/null)"; then
  [[ "$status" =~ ^(400|401|403|496)$ ]] || { echo 'Unauthorized gateway access was not rejected' >&2; exit 1; }
else
  code=$?
  [[ "$status" == 000 && "$code" == 35 || "$status" == 000 && "$code" == 56 ]] ||
    { echo 'Unauthenticated connection failed for an unexpected reason' >&2; exit 1; }
fi
version="$(curl "${tls[@]}" --cert "$2" --key "$3" --fail --write-out $'\n%header{x-navi-inference-broker}' "$url")"
[[ "${version##*$'\n'}" == shared-v1 ]] || { echo 'Shared broker handshake was not present' >&2; exit 1; }
version="${version%$'\n'*}"
printf '%s' "$version" | python3 -c 'import json,re,sys; v=json.load(sys.stdin).get("version"); sys.exit("Invalid Ollama version response") if not isinstance(v, str) or not re.fullmatch(r"[0-9A-Za-z.+-]{1,48}",v) else print("Authenticated Ollama metadata, version",v)'
blocked="$(curl "${tls[@]}" --cert "$2" --key "$3" --output /dev/null --write-out '%{http_code}' "https://$hostname:$port/api/pull")"
[[ "$blocked" == 404 ]] || { echo 'Unexpected response for prohibited model-management route' >&2; exit 1; }
echo 'Loopback, TLS identity, anonymous rejection and prohibited route checks passed. Generation attempts: 0.'
