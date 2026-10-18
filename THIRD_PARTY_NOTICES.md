# Third-party notices

Ghi các thành phần bên thứ ba có điều kiện giấy phép cần thông báo khi phân phối (ảnh Docker / bản build).
Dependency npm thông thường (MIT / Apache-2.0 / ISC / BSD) theo giấy phép trong gói của chúng.

## libvips (qua `sharp`) — LGPL-3.0-or-later

- Dùng bởi: `apps/api` — mã hóa lại ảnh đại diện và ảnh chat (Mốc 6, ADR-141).
- Gói: `sharp@0.35.5` (Apache-2.0) nạp libvips **dựng sẵn** qua `@img/sharp-libvips-<nền tảng>@1.3.4`
  (LGPL-3.0-or-later), **liên kết động**. Dự án **không sửa** libvips.
- Mã nguồn libvips: <https://github.com/libvips/libvips> · bản dựng sẵn và kịch bản dựng:
  <https://github.com/lovell/sharp-libvips> (tag `v1.3.4`).
- Giấy phép: <https://www.gnu.org/licenses/lgpl-3.0.html>. Người nhận bản phân phối được thay thư viện
  libvips dùng chung bằng bản tự dựng tương thích (LGPL-3.0 §4).
