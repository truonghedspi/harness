package com.halo.domain.diagnostic;

/**
 * Phần BIẾN THIÊN của diagnostic — câu trả lời cho "mỗi decision result mang context
 * khác nhau". Thay vì một bag phẳng nhét mọi field, mỗi loại decision là một typed
 * variant với đúng field của nó (DEC-01: không lẫn field type khác).
 *
 * <p>sealed → cold path switch trên typeId() là EXHAUSTIVE (compiler bắt nếu quên case
 * khi thêm type mới). Trên hot path KHÔNG dùng instanceof/virtual dispatch: AuditPort
 * dùng typed overload (dispatch tĩnh compile-time). typeId() chỉ phục vụ:
 *   (1) làm msgTypeId khi offer vào ring buffer ở phase 2,
 *   (2) làm key cho switch jump-table ở AuditPublisher (phase 2).
 */
public sealed interface DecisionPayload
        permits BuyingPowerPayload, AccountStatusPayload {

    int typeId();   // = SBE templateId = ring buffer msgTypeId (phase 2)
}
