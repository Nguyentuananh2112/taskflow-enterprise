#!/usr/bin/env bash
# Forced command cho khóa SSH của GitHub Actions (G1 M1). User `deploy` thuộc nhóm docker ≈ root ⇒ khóa CI
# KHÔNG được mở shell tùy ý. authorized_keys của deploy (runbook deploy §B.1):
#   restrict,command="/usr/local/sbin/taskflow-ci-entry" ssh-ed25519 AAAA… github-actions-deploy
# Cài: install -o root -g root -m 755 ci-entry.sh /usr/local/sbin/taskflow-ci-entry  (root sở hữu ⇒ CI không sửa được)
# Lệnh nhận (SSH_ORIGINAL_COMMAND):
#   deploy <sha40> <api> <web> <migrate> [backup] <sha256 compose.prod.yml> <sha256 Caddyfile>
#                                                 digest sha256:<64 hex>; 2 hash cấu hình là 64 hex
#   rollback
# Mối đe dọa là KHÓA LỘ (ssh thẳng, không qua guard/reviewers) ⇒ khóa CI KHÔNG ghi được file nào (G1 M1 vòng 2):
# compose.prod.yml, Caddyfile, postgres-init, mẫu env, deploy.sh, bootstrap.sh, unit systemd, chính file này đều do
# admin cài tay. CI chỉ gửi hash của cấu hình ở commit cần deploy; lệch file đang cài ⇒ từ chối (exit 3).
set -euo pipefail
umask 077
DIR=${TASKFLOW_DIR:-/opt/taskflow} # chỉ để test; sshd không nhận env từ client (PermitUserEnvironment no)

read -r -a argv <<<"${SSH_ORIGINAL_COMMAND:-}"
cmd="${argv[0]:-}"

case "$cmd" in
  deploy)
    n=${#argv[@]}
    [ "$n" -eq 7 ] || [ "$n" -eq 8 ] ||
      { echo 'deploy <sha40> <api> <web> <migrate> [backup] <sha256 compose.prod.yml> <sha256 Caddyfile>' >&2; exit 2; }
    sha=${argv[1]}
    digests=("${argv[@]:2:n-4}")
    want_compose=${argv[n-2]}
    want_caddy=${argv[n-1]}
    [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { echo "sha sai: $sha" >&2; exit 2; }
    for d in "${digests[@]}"; do [[ "$d" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo "digest sai: $d" >&2; exit 2; }; done
    for h in "$want_compose" "$want_caddy"; do [[ "$h" =~ ^[0-9a-f]{64}$ ]] || { echo "hash cấu hình sai: $h" >&2; exit 2; }; done
    cd "$DIR"
    stale=()
    [ "$(sha256sum compose.prod.yml 2>/dev/null | cut -d' ' -f1)" = "$want_compose" ] || stale+=(compose.prod.yml)
    [ "$(sha256sum Caddyfile 2>/dev/null | cut -d' ' -f1)" = "$want_caddy" ] || stale+=(Caddyfile)
    if [ ${#stale[@]} -gt 0 ]; then
      echo "Cấu hình đang cài lệch commit $sha: ${stale[*]} — admin cài lại cấu hình theo commit $sha (runbook deploy §B.2)" >&2
      exit 3
    fi
    exec bash deploy.sh "$sha" "${digests[@]}"
    ;;
  rollback)
    [ ${#argv[@]} -eq 1 ] || { echo 'rollback không nhận tham số' >&2; exit 2; }
    cd "$DIR" && exec bash deploy.sh --rollback
    ;;
  *)
    echo "Từ chối: khóa CI chỉ được deploy | rollback (nhận: '${SSH_ORIGINAL_COMMAND:-<shell>}')" >&2
    exit 2
    ;;
esac
