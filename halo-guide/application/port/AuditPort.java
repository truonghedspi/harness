package com.halo.application.port;

import com.halo.domain.diagnostic.AccountStatusPayload;
import com.halo.domain.diagnostic.BuyingPowerPayload;
import com.halo.domain.diagnostic.DiagnosticHeader;

/**
 * SEAM duy nhất giữa phase 1 và phase 2. Flow chỉ biết interface này — KHÔNG biết
 * SLF4J, Chronicle, Aeron, ELK tồn tại.
 *
 * <p>PHASE 1: binding = LoggingAuditPort (format + log.* đồng bộ ngay tại chỗ).
 * <p>PHASE 2: binding = RingBufferAuditPort (tryClaim/encode SBE/commit). Flow KHÔNG đổi
 *            một dòng. Đó là định nghĩa "kiến trúc ready hoàn toàn".
 *
 * <p>Typed overload thay vì record(DiagnosticHeader, DecisionPayload): dispatch TĨNH
 * tại compile-time → không instanceof, không virtual dispatch trên hot path (DEC-02).
 * Thêm decision type mới = thêm 1 overload + 1 typed payload + 1 case ở publisher (DEC-03).
 */
public interface AuditPort {

    void recordBuyingPower(DiagnosticHeader header, BuyingPowerPayload payload);

    void recordAccountStatus(DiagnosticHeader header, AccountStatusPayload payload);

    /** Counter cho drop strategy (chỉ có ý nghĩa ở phase 2 — ring buffer đầy → drop). */
    long droppedCount();
}
