package com.halo.application.flow;

import com.halo.application.port.AuditPort;
import com.halo.domain.diagnostic.AccountStatusPayload;
import com.halo.domain.diagnostic.BuyingPowerPayload;
import com.halo.domain.diagnostic.DiagnosticHeader;

/**
 * Orchestrate flow đặt lệnh. So với code cũ:
 *   - BỎ diagnose(errCode) switch riêng → capture NGAY tại điểm quyết định
 *     (validator buying-power đã cầm cash & required trong tay → ghi thẳng).
 *   - KHÔNG bao giờ gọi log ở đây. Chỉ gọi audit.record*() (seam).
 *   - Mô hình "1 record / message": vì fail thì return ngay ở validation đầu tiên fail,
 *     nên mỗi message phát ra đúng MỘT payload (cái quyết định outcome). PASS cũng record
 *     (EXP-01).
 *
 * <p>Payload pre-allocated, reused → zero-alloc. Flow nhận PRIMITIVE đã decode từ shell,
 * KHÔNG thấy DirectBuffer/SBE → giữ application layer sạch khỏi Aeron (MNT-02).
 * Free-text inbound được shell điền sẵn vào {@code inboundNote} (TextSlot scratch).
 */
public final class PlaceOrderFlow {

    private final AuditPort audit;
    private final RiskGateway risk;     // domain port/stub — pure, version-aware

    // pre-allocated, reused per cluster thread
    private final BuyingPowerPayload   bp   = new BuyingPowerPayload();
    private final AccountStatusPayload acct = new AccountStatusPayload();

    public PlaceOrderFlow(AuditPort audit, RiskGateway risk) {
        this.audit = audit;
        this.risk = risk;
    }

    /**
     * @param h          header đã được shell điền correlation keys + clusterTimeMs (deterministic)
     * @param accountId  decoded primitive
     * @param orderValue decoded primitive
     * @param inboundNote scratch TextSlot do shell copy free-text từ inbound SBE (đã ASCII-copy).
     *                    Có thể rỗng (len=0) nếu message không có note.
     * @return errCode (0 = ok)
     */
    public int process(DiagnosticHeader h, long accountId, long orderValue,
                       com.halo.domain.diagnostic.TextSlot inboundNote) {

        // ----- validate_1: account status -----
        byte status = risk.accountStatus(accountId);
        if (status != AccountStatusPayload.ACTIVE) {
            acct.reset();
            acct.accountStatus = status;
            acct.ruleId = Rules.ACCOUNT_NOT_ACTIVE;
            acct.externalNote.copyFrom(inboundNote);     // loại-3: copy free-text vào payload
            h.errCode = Errors.ACCOUNT_NOT_ACTIVE;
            audit.recordAccountStatus(h, acct);          // offer/log — KHÔNG return String
            return h.errCode;
        }

        // ----- validate_2: buying power -----
        bp.reset();
        bp.cash            = risk.cash(accountId);
        bp.stockCollateral = risk.stockCollateral(accountId);
        bp.pendingOrders   = risk.pendingOrders(accountId);
        bp.t0Receivable    = risk.t0Receivable(accountId);
        bp.marginRatioBps  = risk.marginRatioBps(accountId);
        bp.requiredAmount  = orderValue;
        bp.formulaVersion  = risk.formulaVersion();      // short, không phải String
        bp.computedBuyingPower = risk.buyingPower(accountId);

        if (bp.computedBuyingPower < orderValue) {
            bp.shortfall = orderValue - bp.computedBuyingPower;
            bp.ruleId    = Rules.BP_INSUFFICIENT;
            h.errCode    = Errors.NOT_ENOUGH_BUYING_POWER;
            audit.recordBuyingPower(h, bp);
            return h.errCode;
        }

        // ----- PASS -----
        bp.shortfall = 0;
        bp.ruleId    = Rules.BP_OK;
        h.errCode    = 0;
        audit.recordBuyingPower(h, bp);                  // EXP-01: PASS cũng record
        return 0;
    }

    /** Domain-side port (pure). Hiện thực thật ở infrastructure (InMemoryAccountState...). */
    public interface RiskGateway {
        byte  accountStatus(long accountId);
        long  cash(long accountId);
        long  stockCollateral(long accountId);
        long  pendingOrders(long accountId);
        long  t0Receivable(long accountId);
        int   marginRatioBps(long accountId);
        long  buyingPower(long accountId);
        short formulaVersion();
    }

    /** ruleId nội bộ. Description tiếng Việt map ở cold path (ErrorCatalog/RuleRegistry). */
    public static final class Rules {
        public static final int BP_OK              = 1000;
        public static final int BP_INSUFFICIENT    = 1001;
        public static final int ACCOUNT_NOT_ACTIVE = 2001;
        private Rules() {}
    }

    public static final class Errors {
        public static final int NOT_ENOUGH_BUYING_POWER = 1001;
        public static final int ACCOUNT_NOT_ACTIVE      = 2001;
        private Errors() {}
    }
}
