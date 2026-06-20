package com.halo.infrastructure.audit;

import org.agrona.collections.Int2ObjectHashMap;   // primitive-key map → tránh autoboxing

/**
 * Map errCode/ruleId → (severity, description tiếng Việt). Sống ở COLD path
 * (infrastructure). Dùng Agrona Int2ObjectHashMap thay HashMap&lt;Integer,..&gt; để
 * tránh autoboxing key.
 *
 * <p>EXP-05: getDescription() KHÔNG bao giờ trả null (default fallback).
 * <p>severity quyết định log level: dời nguyên cái switch log.info/warn/err của bạn
 * vào đây, dựa trên severity thay vì rải rác trong onSessionMessage().
 */
public final class ErrorCatalog {

    public static final byte SEV_INFO  = 0;   // success / PASS
    public static final byte SEV_WARN  = 1;   // business reject (not_enough_bp, account_not_active)
    public static final byte SEV_ERROR = 2;   // system error

    private record Entry(byte severity, String desc) {}

    private final Int2ObjectHashMap<Entry> byCode = new Int2ObjectHashMap<>();

    public ErrorCatalog() {
        put(0,    SEV_INFO,  "Thành công");
        put(1000, SEV_INFO,  "Sức mua đủ điều kiện");
        put(1001, SEV_WARN,  "Sức mua không đủ");
        put(2001, SEV_WARN,  "Tài khoản không ở trạng thái hoạt động");
        // ... system errors dùng SEV_ERROR
    }

    private void put(int code, byte sev, String desc) { byCode.put(code, new Entry(sev, desc)); }

    public byte severity(int code) {
        Entry e = byCode.get(code);
        return e != null ? e.severity() : SEV_ERROR;   // không rõ → coi như nghiêm trọng
    }

    public String getDescription(int code) {
        Entry e = byCode.get(code);
        return e != null ? e.desc() : "Mã chưa đăng ký: " + code;   // EXP-05: không null
    }
}
