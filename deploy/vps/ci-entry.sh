#!/usr/bin/env bash
# Forced command cho khóa SSH của GitHub Actions (G1 M1). User `deploy` thuộc nhóm docker ≈ root ⇒ khóa CI
# KHÔNG được mở shell tùy ý. authorized_keys của deploy (runbook deploy §B.1):
#   restrict,command="/usr/local/sbin/taskflow-ci-entry" ssh-ed25519 AAAA… github-actions-deploy
# Cài: install -o root -g root -m 755 ci-entry.sh /usr/local/sbin/taskflow-ci-entry  (root sở hữu ⇒ CI không sửa được)
# Lệnh nhận (SSH_ORIGINAL_COMMAND):
#   receive                                       tar trên stdin; chỉ nhận file cấu hình trong danh sách
#   deploy <sha40> <api> <web> <migrate> [backup]  digest sha256:<64 hex>
#   rollback
# deploy.sh / bootstrap.sh / unit systemd / chính file này KHÔNG nhận qua CI — admin cài tay khi đổi (runbook).
set -euo pipefail
umask 077
DIR=${TASKFLOW_DIR:-/opt/taskflow} # chỉ để test; sshd không nhận env từ client (PermitUserEnvironment no)
RECEIVABLE=(compose.prod.yml Caddyfile .env.example .env.api.example .env.backup.example postgres-init/01-roles.sh)

read -r -a argv <<<"${SSH_ORIGINAL_COMMAND:-}"
cmd="${argv[0]:-}"

case "$cmd" in
  receive)
    [ ${#argv[@]} -eq 1 ] || { echo 'receive không nhận tham số' >&2; exit 2; }
    tmp=$(mktemp -d)
    trap 'rm -rf "$tmp"' EXIT
    # Không giữ owner/quyền từ tar; từ chối đường dẫn tuyệt đối / '..' (GNU tar mặc định đã chặn — kiểm lại bên dưới).
    head -c 5000000 | tar -x --no-same-owner --no-same-permissions -C "$tmp" -f -
    for f in "${RECEIVABLE[@]}"; do
      [ -f "$tmp/$f" ] && [ ! -L "$tmp/$f" ] || continue
      install -D -m 640 "$tmp/$f" "$DIR/$f"
      echo "nhận $f"
    done
    ;;
  deploy)
    n=${#argv[@]}
    [ "$n" -eq 5 ] || [ "$n" -eq 6 ] || { echo 'deploy <sha40> <api> <web> <migrate> [backup]' >&2; exit 2; }
    [[ "${argv[1]}" =~ ^[0-9a-f]{40}$ ]] || { echo "sha sai: ${argv[1]}" >&2; exit 2; }
    for d in "${argv[@]:2}"; do [[ "$d" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo "digest sai: $d" >&2; exit 2; }; done
    cd "$DIR" && exec bash deploy.sh "${argv[@]:1}"
    ;;
  rollback)
    [ ${#argv[@]} -eq 1 ] || { echo 'rollback không nhận tham số' >&2; exit 2; }
    cd "$DIR" && exec bash deploy.sh --rollback
    ;;
  *)
    echo "Từ chối: khóa CI chỉ được receive | deploy | rollback (nhận: '${SSH_ORIGINAL_COMMAND:-<shell>}')" >&2
    exit 2
    ;;
esac
