package com.halo.domain.diagnostic;

import java.nio.charset.StandardCharsets;

/**
 * Slot text tái sử dụng cho loại-3 (free-text nhận từ ngoài: reason text từ sàn,
 * note từ hệ thống downstream...). Cấp phát byte[] đúng MỘT lần, reused mỗi message.
 *
 * <p>NGUYÊN TẮC:
 * <ul>
 *   <li>Domain layer THUẦN — chỉ phụ thuộc java.lang/java.nio. KHÔNG import Agrona.
 *       Việc copy từ inbound buffer của Aeron nằm ở shell/adapter, nhưng nguồn được
 *       truyền vào đây dưới dạng {@link CharSequence} — nên {@code AsciiSequenceView}
 *       (Agrona, implements CharSequence) đi vào qua cửa polymorphic mà domain không
 *       cần biết Agrona tồn tại.</li>
 *   <li>byte[] primitive → reset chỉ cần {@code len = 0}, KHÔNG leak reference khách
 *       hàng trước (bug cố hữu của String[]).</li>
 *   <li>ASCII-only. Tiếng Việt có dấu KHÔNG dùng slot này — phải là enum code (loại-1).
 *       Xem ghi chú charset cuối file.</li>
 * </ul>
 */
public final class TextSlot {
    public static final int CAP = 64;          // bounded → fit cache budget; truncate nếu vượt

    private final byte[] buf = new byte[CAP];   // reused, cấp phát 1 lần
    private int len;

    /**
     * Hot path: copy ASCII bytes từ nguồn (vd AsciiSequenceView wrap inbound buffer).
     * Copy NGAY trong hot path → data sống trong byte[] của ta → an toàn cho cả
     * phase 1 (log đồng bộ) lẫn phase 2 (offer sang cold path). Đây là điểm mấu chốt:
     * copy biến view "chỉ-an-toàn-đồng-bộ" thành dữ liệu sở hữu được.
     */
    public void copyFromAscii(CharSequence src) {
        final int n = Math.min(src.length(), CAP);
        for (int i = 0; i < n; i++) {
            buf[i] = (byte) src.charAt(i);      // ASCII narrow; ký tự > 0x7F sẽ hỏng
        }
        this.len = n;
    }

    /** Copy slot→slot (vd shell điền scratch rồi flow copy vào payload). Pure, no Agrona. */
    public void copyFrom(TextSlot other) {
        System.arraycopy(other.buf, 0, this.buf, 0, other.len);
        this.len = other.len;
    }

    public void clear() { this.len = 0; }       // reset: KHÔNG cần xóa byte, len=0 là đủ

    public int length() { return len; }

    /** Cho phase 2: copy byte thẳng vào SBE var-data field, KHÔNG qua String. */
    public byte[] raw() { return buf; }

    /**
     * PHASE 1 cold-side: dựng String để log/ELK.
     * <p>// PHASE 2: bước này BIẾN MẤT ở hot path. RingBufferAuditPort copy raw()[0..len]
     * thẳng vào SBE → AuditPublisher mới materialize() khi ship ELK (trên publisher thread).
     */
    public String materialize() {
        return new String(buf, 0, len, StandardCharsets.US_ASCII);
    }
}
