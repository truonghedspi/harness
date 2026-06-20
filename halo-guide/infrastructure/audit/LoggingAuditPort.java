package com.halo.infrastructure.audit;

import com.halo.application.port.AuditPort;
import com.halo.domain.diagnostic.AccountStatusPayload;
import com.halo.domain.diagnostic.BuyingPowerPayload;
import com.halo.domain.diagnostic.DiagnosticAction;
import com.halo.domain.diagnostic.DiagnosticHeader;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * ====================== PHASE 1 ADAPTER ======================
 * Format + log ĐỒNG BỘ ngay trên cluster thread. Chấp nhận được vì go-live ít user.
 *
 * <p>TOÀN BỘ String building chỉ sống Ở ĐÂY — sau seam AuditPort. Flow không thấy nó.
 *
 * <p>// PHASE 2: thay binding bằng RingBufferAuditPort. Mỗi method dưới đây co lại còn
 *    tryClaim/encode SBE/commit (zero String, zero log). Đoạn StringBuilder + log.*
 *    DI CHUYỂN nguyên vẹn xuống AuditPublisher (cold path) — không vứt đi, vì ELK vẫn
 *    cần dòng human-readable. Cái biến mất là lời gọi log ĐỒNG BỘ trên cluster thread.
 *
 * <p>Log dạng STRUCTURED key=value → answerable bằng aggregation (grep/sum theo poolId,
 * accountId...) ngay ở phase 1, và map gần 1-1 sang ELK doc ở phase 2.
 *
 * <p>An toàn cluster thread: StringBuilder reused KHÔNG thread-safe — OK vì cluster thread
 * single-threaded per shard. Đừng share instance này ra ngoài.
 */
public final class LoggingAuditPort implements AuditPort {

    private static final Logger log = LoggerFactory.getLogger("halo.audit");

    private final StringBuilder sb = new StringBuilder(256);   // reused
    private final ErrorCatalog catalog;

    public LoggingAuditPort(ErrorCatalog catalog) { this.catalog = catalog; }

    @Override
    public void recordBuyingPower(DiagnosticHeader h, BuyingPowerPayload p) {
        sb.setLength(0);
        appendHeader(h);
        sb.append(" decision=BUYING_POWER")
          .append(" rule=").append(p.ruleId)
          .append(" cash=").append(p.cash)
          .append(" required=").append(p.requiredAmount)
          .append(" bp=").append(p.computedBuyingPower)
          .append(" shortfall=").append(p.shortfall)
          .append(" fv=").append(p.formulaVersion)
          // loại-2: câu giải thích DỰNG ở đây từ số — không pre-build trên hot path
          .append(" msg=\"").append(catalog.getDescription(p.ruleId)).append('"');
        emit(h);
        // PHASE 2: ↑ toàn bộ block này → AuditPublisher.handleBuyingPower() (cold path).
        //          RingBufferAuditPort chỉ: tryClaim(BuyingPowerPayload.TYPE_ID, len) → encode → commit.
    }

    @Override
    public void recordAccountStatus(DiagnosticHeader h, AccountStatusPayload p) {
        sb.setLength(0);
        appendHeader(h);
        sb.append(" decision=ACCOUNT_STATUS")
          .append(" rule=").append(p.ruleId)
          .append(" status=").append(AccountStatusPayload.statusName(p.accountStatus));
        if (p.externalNote.length() > 0) {
            // loại-3: materialize() tạo String Ở ĐÂY (cold-side của phase 1) — không phải hot path
            sb.append(" note=\"").append(p.externalNote.materialize()).append('"');
            // PHASE 2: KHÔNG materialize. RingBufferAuditPort copy externalNote.raw()[0..len]
            //          thẳng vào SBE var-data → byte→byte, không qua String.
        }
        sb.append(" msg=\"").append(catalog.getDescription(p.ruleId)).append('"');
        emit(h);
    }

    @Override public long droppedCount() { return 0; }   // phase 1 đồng bộ → không drop

    // ---- helpers ----

    private void appendHeader(DiagnosticHeader h) {
        sb.append("ts=").append(h.clusterTimeMs)
          .append(" reqId=").append(h.requestId)
          .append(" date=").append(h.tradingDate)
          .append(" shard=").append(h.shardId)
          .append(" acct=").append(h.accountId)
          .append(" action=").append(DiagnosticAction.name(h.action))
          .append(" err=").append(h.errCode);
    }

    /** Switch log level theo severity — chính là logic log.info/warn/err của bạn, gom 1 chỗ. */
    private void emit(DiagnosticHeader h) {
        final String msg = sb.toString();
        switch (catalog.severity(h.errCode)) {
            case ErrorCatalog.SEV_ERROR -> log.error(msg);
            case ErrorCatalog.SEV_WARN  -> log.warn(msg);
            default                     -> log.info(msg);
        }
    }
}
