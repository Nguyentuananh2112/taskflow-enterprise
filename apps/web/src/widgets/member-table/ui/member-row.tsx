'use client';

import type { WorkspaceRole } from '@taskflow/contracts/rbac';
import type { MemberDto } from '@taskflow/contracts/workspace';

import { ROLE_LABEL, type PermissionApi } from '@/entities/workspace';
import { RoleSelect } from '@/features/member-change-role';
import { RemoveMemberButton } from '@/features/member-remove';
import { Avatar } from '@/shared/ui/avatar';
import { Badge } from '@/shared/ui/badge';

type Props = Readonly<{
  wsId: string;
  member: MemberDto;
  permission: PermissionApi;
  onLeft: () => void;
}>;

/** security.md §3.2: OWNER xóa bất kỳ (trừ OWNER cuối — server chặn); PM chỉ MEMBER/VIEWER. */
function canRemove(actor: WorkspaceRole | null, target: WorkspaceRole): boolean {
  if (actor === 'OWNER') return true;
  return actor === 'PM' && (target === 'MEMBER' || target === 'VIEWER');
}

const joined = (iso: string) => new Date(iso).toLocaleDateString('vi-VN');

export function MemberRow({ wsId, member, permission, onLeft }: Props) {
  const isSelf = member.userId === permission.viewerId;
  const showRemove = isSelf || canRemove(permission.role, member.role);
  return (
    <tr className="border-t border-border">
      <td className="py-2 pr-3">
        <span className="flex items-center gap-2">
          <Avatar
            name={member.fullName}
            colorKey={member.userId}
            src={member.avatarUrl}
            size="sm"
            loading="lazy"
            decorative
          />
          <span className="flex flex-col">
            <span className="font-medium">
              {member.fullName}
              {isSelf && <span className="text-text-muted"> (bạn)</span>}
            </span>
            <span className="text-xs break-all text-text-muted">{member.email}</span>
          </span>
        </span>
      </td>
      <td className="py-2 pr-3">
        {permission.can('member:update-role') ? (
          <RoleSelect wsId={wsId} member={member} isSelf={isSelf} onLeft={onLeft} />
        ) : (
          <Badge>{ROLE_LABEL[member.role]}</Badge>
        )}
      </td>
      <td className="hidden py-2 pr-3 text-sm sm:table-cell">{joined(member.joinedAt)}</td>
      <td className="py-2 text-right">
        {showRemove && (
          <RemoveMemberButton wsId={wsId} member={member} isSelf={isSelf} onLeft={onLeft} />
        )}
      </td>
    </tr>
  );
}
