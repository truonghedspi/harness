package com.halo.domain.diagnostic;

/**
 * Payload cho BuyingPower (Tier-1). Minh hoạ loại-1 (code) + loại-2 (câu giải thích
 * dựng từ SỐ): KHÔNG carry chuỗi nào. Câu "Sức mua 170tr < lệnh 178tr, thiếu 8tr"
 * được DỰNG ở cold path từ các con số dưới đây — không pre-build trên hot path.
 *
 * <p>Reused một instance (pre-allocated trong flow). Verdict suy ra từ shortfall/ruleId.
 */
public final class BuyingPowerPayload implements DecisionPayload {
    public static final int TYPE_ID = 1;

    // inputs (nguyên liệu — capture tại điểm quyết định)
    public long cash;
    public long stockCollateral;
    public long pendingOrders;
    public long t0Receivable;
    public int  marginRatioBps;
    public long requiredAmount;       // = orderValue

    // computed
    public long computedBuyingPower;
    public long shortfall;            // 0 nếu PASS

    // explainability (loại-1: code, không phải text)
    public short formulaVersion;      // KHÔNG phải String "formula" — EXP-02/CMP-03
    public int   ruleId;              // map description tiếng Việt ở cold path — EXP-05

    @Override public int typeId() { return TYPE_ID; }

    public void reset() {
        cash = stockCollateral = pendingOrders = t0Receivable = 0;
        marginRatioBps = 0; requiredAmount = 0;
        computedBuyingPower = shortfall = 0;
        formulaVersion = 0; ruleId = 0;
    }
}
