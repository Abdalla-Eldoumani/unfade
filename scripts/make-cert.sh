#!/usr/bin/env bash
# Makes a self-signed certificate in .cert/ so the dev server and the demo
# server speak HTTPS. WebXR refuses to start on plain HTTP over the network.
# The headset will warn once ("connection is not private"): choose Advanced,
# then Proceed. With no arguments it covers this laptop's current network
# addresses; run it again after switching networks. Or name them:
#   npm run cert -- 192.168.137.1
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .cert

if [ "$#" -eq 0 ]; then
  set -- $(node -e "for (const i of Object.values(require('os').networkInterfaces()).flat()) if (i && i.family === 'IPv4' && !i.internal) console.log(i.address)")
fi

san="DNS:localhost,IP:127.0.0.1"
for extra in "$@"; do
  if [[ "$extra" =~ ^[0-9.]+$ ]]; then san="$san,IP:$extra"; else san="$san,DNS:$extra"; fi
done

# A config file instead of -subj keeps Git Bash on Windows from rewriting
# the "/CN=..." argument into a file path.
cat > .cert/openssl.cnf <<EOF
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = unfade-dev
[ext]
subjectAltName = $san
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
EOF

openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 30 \
  -keyout .cert/key.pem -out .cert/cert.pem -config .cert/openssl.cnf
echo "Made .cert/cert.pem for: $san (valid 30 days)"
