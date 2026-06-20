package com.halo.domain.diagnostic;

/**
 * Header chung — giống nhau cho MỌI flow & MỌI decision. Đây là câu trả lời cho
 * "context mỗi flow khác nhau": phần GIỐNG nhau gom hết vào đây, phần KHÁC nhau
 * nằm ở {@link DecisionPayload}.
 *
 * <p>Reused một instance per cluster thread (single-threaded per shard). Overwrite
 * toàn bộ field mỗi message → {@link #reset()} chỉ cần lo các field có thể "sót".
 *
 * <p>PRIMITIVE-ONLY. userId/accountId/ticker là số (long/int) — render text ở cold path.
 * causalId dạng chuỗi human-readable là PROJECTION cold-path, KHÔNG carry ở đây.
 */
public final class DiagnosticHeader {

    // --- correlation keys (tất cả primitive) ---
    public long logPosition;     // Raft log position (do shell set)
    public long clusterTimeMs;   // = timestamp Aeron truyền vào onSessionMessage(). KHÔNG currentTimeMillis()
    public long requestId;       // = correlationId int64 — carrier xuyên mọi hop (TRC-02)
    public int  tradingDate;     // yyyymmdd dạng int (vd 20250315)
    public int  shardId;
    public long userId;
    public long accountId;

    // --- outcome ---
    public byte action;          // DiagnosticAction.*
    public int  errCode;         // 0 = success; != 0 = mã lỗi (map text/severity ở cold path)

    public boolean hasErr()      { return errCode != 0; }

    /** Reset trước mỗi message. Field bị overwrite hoàn toàn nên chỉ cần lo outcome. */
    public void reset() {
        errCode = 0;
        // các correlation key được shell set lại mỗi message; không cần zero ở đây
    }
}
