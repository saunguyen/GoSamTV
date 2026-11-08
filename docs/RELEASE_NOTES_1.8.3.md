# GoSamTV Lite 1.8.3

Ngày phát hành: 08/11/2026

## Nội dung cập nhật

Phiên bản này tập trung giải quyết phản hồi của người dùng Samsung Smart Remote về nút **123** và thao tác tìm kiếm.

- Thêm bàn phím số **123 Chọn kênh** bên trong ứng dụng, điều khiển bằng phím hướng và OK.
- Bổ sung cơ chế đăng ký phím số được Samsung Tizen hỗ trợ. Bảng số 123 của hệ điều hành có thể không chuyển sự kiện đến ứng dụng, do đó bàn phím số tích hợp là lựa chọn dự phòng.
- Chuyển kênh theo số thứ tự trong danh mục 178 kênh, không theo danh sách đang lọc.
- Xử lý **RETURN**, **Cancel** và thêm nút **Thoát** để rời ô tìm kiếm.
- Giữ nguyên các tính năng của bản Lite: 147 kênh truyền hình, 31 radio, yêu thích, lịch phát sóng, thêm M3U, màn hình radio có sóng và OSD tự ẩn.
- Hiển thị đúng **Phiên bản 1.8.3** trong phần Info.

## Tải về

- [GoSamTV Lite 1.8.3 — bản chính](../dist/GoSamTV-1.8.3.wgt)
- [GoSamTV Lite 1.8.3 — bản tương thích](../dist/GoSamTV-1.8.3-compat.wgt)

Hai gói đã được xác minh cấu trúc và chữ ký. **Chưa xác nhận trực tiếp bản 1.8.3 trên phần cứng Samsung CU8000**; cần kiểm tra trên TV thật.

## Kiểm thử

Đã đạt trên Chrome: rời ô tìm kiếm bằng Escape/Cancel mô phỏng, dùng bàn phím số trong app chọn kênh 12 khi đang xem từ kết quả tìm kiếm, đóng bàn phím số bằng RETURN và bấm trực tiếp số 8. Giữ nguyên 178 kênh và không phát hiện lỗi JavaScript trong bài kiểm tra.

Phần nhận phím số trực tiếp vẫn phụ thuộc cách Samsung Smart Remote chuyển sự kiện đến ứng dụng trên từng TV.
