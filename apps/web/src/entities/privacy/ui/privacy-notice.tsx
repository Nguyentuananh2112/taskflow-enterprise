import type { ReactNode } from 'react';

// Thông báo xử lý dữ liệu cá nhân (data-retention.md §5 + đoạn Mốc 6 + đoạn Mốc 4, main ffaf0471). Thời hạn theo phương
// án B đã chốt (D1–D7) + D12–D15. Đổi chữ ở đây ⇒ server tăng `version` (nhân viên phải đọc lại).

type Props = Readonly<{
  companyName: string | null;
  /** `privacyContact` của công ty; trống ⇒ "quản trị viên của công ty". */
  contact: string | null;
  /** Mức tiêu đề của các mục (trang: h2; hộp thoại: h3 dưới tiêu đề hộp thoại). */
  level?: 2 | 3;
}>;

function Section({ title, level, children }: { title: string; level: 2 | 3; children: ReactNode }) {
  const H = level === 2 ? 'h2' : 'h3';
  return (
    <section className="flex flex-col gap-2">
      <H className="text-base font-semibold">{title}</H>
      <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm">{children}</ul>
    </section>
  );
}

export function PrivacyNotice({ companyName, contact, level = 2 }: Props) {
  const company = companyName?.trim() || 'Công ty';
  const who = contact?.trim() || 'quản trị viên của công ty';
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm">
        <strong>{company}</strong> (bên kiểm soát dữ liệu) xử lý các dữ liệu sau của bạn qua
        TaskFlow.
      </p>
      <Section title="Chấm công & Nghỉ phép" level={level}>
        <li>
          <strong>Giờ chấm vào / ra</strong> để tính công và tiền lương — lưu <strong>2 năm</strong>{' '}
          trên TaskFlow; bảng công tháng được lưu tại bộ phận kế toán theo quy định về lưu trữ chứng
          từ.
        </li>
        <li>
          <strong>Địa chỉ IP và thông tin trình duyệt</strong> lúc chấm công, chỉ để đối chiếu khi
          có khiếu nại; không dùng để chấm điểm hay quyết định — tự động xóa sau{' '}
          <strong>13 tháng</strong>.
        </li>
        <li>
          <strong>Đơn nghỉ phép và số ngày phép.</strong>{' '}
          <strong>Lý do nghỉ là không bắt buộc.</strong> Nếu bạn ghi lý do liên quan sức khỏe, đó là
          dữ liệu nhạy cảm: chỉ bạn và người được giao quản lý nhân sự xem được; không xuất hiện
          trong báo cáo, thông báo hay nhật ký; tự động xóa sau <strong>13 tháng</strong> kể từ ngày
          kết thúc đơn.
        </li>
        <li>
          Thông báo trong ứng dụng được giữ <strong>180 ngày</strong>; nhật ký thao tác quản trị
          nhân sự giữ <strong>5 năm</strong> (không chứa IP hay lý do nghỉ).
        </li>
        <li>
          Bạn có thể xem giờ chấm và thông tin IP của chính mình trong mục &quot;Lịch sử chấm
          công&quot;.
        </li>
      </Section>
      <Section title="Trò chuyện & ảnh đại diện" level={level}>
        <li>
          Tin nhắn và tệp bạn gửi được lưu <strong>12 tháng</strong> rồi tự xóa. Tin bạn xóa biến
          khỏi ứng dụng ngay; bản sao lưu (đã mã hóa) có thể còn tới hết hạn giữ bản sao lưu.
        </li>
        <li>
          Tin nhắn <strong>không mã hóa đầu-cuối</strong>: quản trị viên và nhân sự{' '}
          <strong>không</strong> đọc được trò chuyện của bạn qua ứng dụng, nhưng người vận hành máy
          chủ về kỹ thuật có thể truy cập dữ liệu lưu trữ. Đừng gửi mật khẩu, số thẻ hay thông tin
          sức khỏe qua trò chuyện.
        </li>
        <li>
          Ảnh đại diện hiện cho mọi người trong công ty. Bạn đổi hoặc xóa được bất cứ lúc nào; khi
          bạn rời công ty ảnh bị xóa sau 30 ngày.
        </li>
        <li>
          Muốn xem hoặc xóa trò chuyện của mình: liên hệ đầu mối bên dưới — hiện xử lý thủ công, có
          biên bản (không có nút tự phục vụ).
        </li>
      </Section>
      <Section title="Phiếu lương" level={level}>
        <li>
          Công ty xử lý <strong>hồ sơ lương</strong> (bậc, lương cơ bản, phụ cấp) và{' '}
          <strong>phiếu lương hằng tháng</strong> của bạn để trả lương. Chỉ bạn, người được giao
          quyền Kế toán và quản trị viên xem được. Thông báo có phiếu mới <strong>không</strong>{' '}
          chứa số tiền. Người vận hành máy chủ về kỹ thuật có thể truy cập dữ liệu lưu trữ; bản sao
          lưu được mã hóa.
        </li>
        <li>
          Phiếu lương đã phát hành là chứng từ kế toán nên được lưu <strong>10 năm</strong> kể từ kỳ
          lương, kể cả sau khi bạn nghỉ việc.
        </li>
        <li>
          Trong thời hạn lưu bắt buộc này, công ty <strong>không xóa</strong> phiếu lương theo yêu
          cầu (nghĩa vụ pháp lý), nhưng bạn có thể yêu cầu <strong>sửa</strong> thông tin sai.
        </li>
        <li>
          Nếu kế toán điều chỉnh công hoặc lương của bạn, lý do điều chỉnh hiện trên phiếu để bạn
          xem và được lưu cùng phiếu.
        </li>
      </Section>
      <p className="text-sm">
        Để yêu cầu xem, sửa hoặc xóa dữ liệu (kể cả thắc mắc về phiếu lương), liên hệ{' '}
        <strong>{who}</strong>.
      </p>
    </div>
  );
}
