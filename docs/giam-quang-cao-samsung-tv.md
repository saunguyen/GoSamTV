# Giảm quảng cáo và app rác trên TV Samsung (Tizen)

Ghi chú thực tế sau khi thử trực tiếp trên **UA55CU8000KXXV** (Tizen 7). Tóm lại: **từ PC không gỡ
được app trên TV**, nhưng **giảm quảng cáo thì làm được** bằng vài bước dưới đây.

## 1. Vì sao PC không gỡ được app

| Việc | Kết quả trên máy này |
|---|---|
| Cài app từ PC (Apps2Samsung, `sdb install`) | ✅ được (chế độ Developer trên TV) |
| Gỡ app từ PC (`sdb uninstall`, `pkgcmd -u`) | ❌ `sdb shell` bị khoá, chỉ cho vài lệnh như `vd_applist`; `pkgcmd`/`wascmd` bị chặn |
| Gỡ app **cài sẵn** của Samsung | ❌ không gỡ được kể cả khi có quyền, trừ khi root/custom firmware |
| Gỡ app do **bạn tự cài** | ✅ được — nhưng phải làm trên TV: Home → chọn app → Remove, hoặc Apps → Settings |

Cái duy nhất làm được từ PC là **cài** và **liệt kê** app (`sdb shell 0 vd_applist`).

## 2. Ẩn bớt app rác (làm trên TV)

1. **Home → Edit** (hoặc giữ OK trên một ô trống): bỏ chọn các app không dùng để chúng rời màn hình
   chính; app cài sẵn vẫn nằm trong danh sách nhưng không hiện ra.
2. **Samsung TV Plus** (nguồn quảng cáo nhiều nhất): Apps → chọn *TV Plus* → **Remove** nếu máy cho
   phép; nếu không, vào *Settings → Broadcasting → Samsung TV Plus* tắt tự khởi động.
3. **Settings → Support → Terms & Privacy**: tắt
   - *Interest-Based Advertisements* (quảng cáo theo sở thích)
   - *Viewing Information Services* (ACR — ghi nhận nội dung đang xem)
   - *Voice Recognition / Marketing* nếu không dùng

## 3. Chặn quảng cáo bằng DNS (hiệu quả nhất, không cần hack TV)

TV Samsung lấy quảng cáo và "gợi ý" từ một số domain riêng. Chặn ở tầng DNS thì quảng cáo không tải
được, TV vẫn dùng bình thường.

**Cách làm:** đặt DNS của TV (Settings → Network → Network Status → IP Settings → DNS) về máy chủ chặn
quảng cáo:

- **NextDNS**: tạo profile, bật blocklist, dùng DNS riêng của profile.
- **AdGuard Home / Pi-hole** trong nhà: trỏ TV về IP máy đó, thêm danh sách `tools/samsung-adblock.txt`.

**Danh sách domain** (đã kiểm tra có phân giải; xem `tools/samsung-adblock.txt`):

| Domain | Dùng cho |
|---|---|
| `samsungads.com` (+ subdomain) | quảng cáo trên Home / banner |
| `samsungtvplus.com` (+ subdomain) | kênh và quảng cáo TV Plus |
| `osb-apps.samsungqbe.com` | "gợi ý" app/nội dung trên Home |
| `notice.samsungcloudsolution.com` | thông báo/khuyến mãi đẩy xuống TV |

> ⚠️ **Đừng chặn `cdn.samsungcloudsolution.com`** — đó là CDN dùng cho App Store/cập nhật, chặn sẽ làm
> store và app lỗi. Tương tự, chặn quá tay các domain `*.samsung.com` có thể làm TV mất chức năng.

## 4. Dùng GoSamTV làm màn hình chính

TV Samsung không cho app bên thứ ba tự chạy khi bật máy (trừ chế độ Hospitality), nhưng bạn có thể:

- Ghim GoSamTV ở ô đầu tiên của Home để bấm 1 lần là vào.
- Khi đang mở GoSamTV thì không thấy quảng cáo của Samsung nữa.

## 5. Những thứ **không** nên làm

- Root / custom firmware: mất bảo hành, dễ brick, và không có bản dựng ổn định cho dòng CU8000.
- Chặn toàn bộ `*.samsung.com`: TV mất store, mất cập nhật, có thể lỗi khởi động app.
- Dùng APK "adblock" cho Android TV: TV Samsung không chạy APK.
