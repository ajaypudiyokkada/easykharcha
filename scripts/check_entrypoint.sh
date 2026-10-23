#!/bin/sh
# Step C2c: a quick, dependency-free proof that backend/entrypoint.sh (a) runs a given command
# instead of always falling through to gunicorn, and (b) still defaults to gunicorn with none given.
# Doesn't need Docker or a real database — RUN_SETUP=0 skips migrate/load_pincodes/collectstatic,
# and the "gunicorn" on PATH is a stub for this run only, so no real server actually starts.
set -e

cd "$(dirname "$0")/../backend"

echo "--- entrypoint.sh: a given command runs as-is ---"
out=$(RUN_SETUP=0 sh entrypoint.sh python -c "print(1)")
if [ "$out" != "1" ]; then
    echo "FAIL: expected output '1' from a passed-through command, got '$out'"
    exit 1
fi
echo "OK — entrypoint.sh python -c \"print(1)\" ran the given command."

echo "--- entrypoint.sh: no command still defaults to gunicorn ---"
stub_dir=$(mktemp -d)
trap 'rm -rf "$stub_dir"' EXIT
cat > "$stub_dir/gunicorn" <<'EOF'
#!/bin/sh
echo "STUB_GUNICORN_STARTED $*"
EOF
chmod +x "$stub_dir/gunicorn"
out=$(RUN_SETUP=0 PATH="$stub_dir:$PATH" sh entrypoint.sh)
case "$out" in
    *STUB_GUNICORN_STARTED*) echo "OK — entrypoint.sh with no command still starts gunicorn." ;;
    *)
        echo "FAIL: expected the gunicorn stub to run, got '$out'"
        exit 1
        ;;
esac

echo "entrypoint.sh checks passed."
