import { useEffect, useMemo, useRef, useState } from "react";

type Health = {
  mode: "mock" | "mcd";
  provider: string;
  modelConfigured: boolean;
  protocolVersion: string;
};

type Address = {
  addressId: string;
  contactName: string;
  phone: string;
  fullAddress: string;
};

type Store = {
  storeCode: string;
  beCode: string;
  storeName: string;
  businessStatus: boolean;
  businessStartTime?: string;
  businessEndTime?: string;
};

type MenuItem = {
  productCode: string;
  name: string;
  price: number;
  tags: string[];
  caloriesKcal?: number;
  category?: string;
  description?: string;
};

type MealDetail = {
  code: string;
  name: string;
  description?: string;
  image?: string;
  supportModify?: boolean;
  rounds?: Array<{
    name?: string;
    choices: Array<{ name: string; code?: string; quantity?: number }>;
  }>;
};

type Coupon = {
  couponId: string;
  couponCode: string;
  title: string;
  validPeriod?: string;
  products?: Array<{ productCode: string; productName: string }>;
};

type CartItem = {
  productCode: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  caloriesKcal?: number;
};

type Quote = {
  approvalId: string;
  quoteId: string;
  quoteHash: string;
  context: {
    address: { fullAddress: string; contactName: string; phone: string };
    storeName: string;
  };
  items: CartItem[];
  productPrice: number;
  deliveryPrice: number;
  discount: number;
  totalPrice: number;
  expiresAt: string;
};

type Order = {
  orderId: string;
  payH5Url?: string;
  orderStatus: string;
  totalAmount: number;
  storeName?: string;
  deliveryAddress?: string;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

type TimelineItem = {
  id: string;
  name: string;
  status: string;
};

const initialMessage: ChatMessage = {
  id: "welcome",
  role: "assistant",
  text: "你好，我是 AI 麦乐送助手。告诉我想吃什么，我会先查询菜单并核价；创建待支付订单前，一定会把地址、商品和总价交给你确认。",
};

const money = (value: number) => `¥${Number(value || 0).toFixed(2)}`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function textValue(value: unknown, maxLength = 500): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength ? normalized : undefined;
}

function imageValue(value: unknown): string | undefined {
  const candidate = textValue(value, 2_000);
  return candidate && (/^https?:\/\//i.test(candidate) || (candidate.startsWith("/") && !candidate.startsWith("//")))
    ? candidate
    : undefined;
}

function parseMealDetail(value: unknown): MealDetail | null {
  if (!isRecord(value)) return null;
  const code = textValue(value.code, 120);
  const name = textValue(value.name, 200);
  if (!code || !name) return null;
  const detail: MealDetail = { code, name };
  const description = textValue(value.description);
  const image = imageValue(value.image);
  if (description) detail.description = description;
  if (image) detail.image = image;
  if (typeof value.supportModify === "boolean") detail.supportModify = value.supportModify;
  if (Array.isArray(value.rounds)) {
    const rounds = value.rounds.flatMap((round): MealDetail["rounds"] => {
      if (!isRecord(round) || !Array.isArray(round.choices)) return [];
      const choices = round.choices.flatMap((choice) => {
        if (!isRecord(choice)) return [];
        const choiceName = textValue(choice.name, 200);
        if (!choiceName) return [];
        const safeChoice: { name: string; code?: string; quantity?: number } = { name: choiceName };
        const choiceCode = textValue(choice.code, 120);
        const quantity = typeof choice.quantity === "number" && Number.isInteger(choice.quantity) && choice.quantity > 0 && choice.quantity <= 20
          ? choice.quantity
          : undefined;
        if (choiceCode) safeChoice.code = choiceCode;
        if (quantity) safeChoice.quantity = quantity;
        return [safeChoice];
      });
      if (!choices.length) return [];
      const safeRound: NonNullable<MealDetail["rounds"]>[number] = { choices };
      const roundName = textValue(round.name, 200);
      if (roundName) safeRound.name = roundName;
      return [safeRound];
    }).filter((round): round is NonNullable<MealDetail["rounds"]>[number] => Boolean(round));
    if (rounds.length) detail.rounds = rounds;
  }
  return detail;
}

function parseCoupons(value: unknown): Coupon[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((coupon): Coupon[] => {
    if (!isRecord(coupon)) return [];
    const couponId = textValue(coupon.couponId, 120);
    const couponCode = textValue(coupon.couponCode, 120);
    const title = textValue(coupon.title, 300);
    if (!couponId || !couponCode || !title) return [];
    const safeCoupon: Coupon = { couponId, couponCode, title };
    const validPeriod = textValue(coupon.validPeriod, 300);
    if (validPeriod) safeCoupon.validPeriod = validPeriod;
    if (Array.isArray(coupon.products)) {
      const products = coupon.products.flatMap((product) => {
        if (!isRecord(product)) return [];
        const productCode = textValue(product.productCode, 120);
        const productName = textValue(product.productName, 200);
        return productCode && productName ? [{ productCode, productName }] : [];
      });
      if (products.length) safeCoupon.products = products;
    }
    return [safeCoupon];
  });
}

function readableToolName(name: string): string {
  const names: Record<string, string> = {
    list_delivery_addresses: "查询配送地址",
    list_deliverable_stores: "查询可配送门店",
    list_menu: "查询菜单",
    get_meal_detail: "查询餐品详情",
    list_store_coupons: "查询优惠券",
    add_to_cart: "加入购物车",
    view_cart: "查看购物车",
    calculate_price: "核算价格",
    get_order_status: "查询订单状态",
  };
  return names[name] || name;
}

function createId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [sessionId, setSessionId] = useState(() => window.localStorage.getItem("mcd-session-id") || "");
  const [messages, setMessages] = useState<ChatMessage[]>([initialMessage]);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState("");
  const [selectedStoreKey, setSelectedStoreKey] = useState("");
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [mealDetail, setMealDetail] = useState<MealDetail | null>(null);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);

  const cartCount = useMemo(() => cart.reduce((sum, item) => sum + item.quantity, 0), [cart]);
  const cartSubtotal = useMemo(
    () => cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0),
    [cart],
  );
  const cartCalories = useMemo(() => {
    if (cart.some((item) => typeof item.caloriesKcal !== "number")) return undefined;
    return cart.reduce((sum, item) => sum + (item.caloriesKcal || 0) * item.quantity, 0);
  }, [cart]);
  const selectedAddress = addresses.find((item) => item.addressId === selectedAddressId) || addresses[0];
  const selectedStore = stores.find((item) => `${item.storeCode}:${item.beCode}` === selectedStoreKey) || stores[0];

  useEffect(() => {
    void fetch("/api/health")
      .then(async (response) => {
        if (!response.ok) throw new Error("服务端尚未启动");
        return (await response.json()) as Health;
      })
      .then(setHealth)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "无法连接服务端"));
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, timeline]);

  function addAssistant(text: string): void {
    setMessages((current) => [...current, { id: createId(), role: "assistant", text }]);
  }

  function clearStoreScopedResults(): void {
    setMealDetail(null);
    setCoupons([]);
  }

  function handleEvent(eventName: string, data: unknown): void {
    const value = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
    if (eventName === "session") {
      const nextId = String(value.sessionId || "");
      if (nextId) {
        setSessionId(nextId);
        window.localStorage.setItem("mcd-session-id", nextId);
      }
      return;
    }
    if (eventName === "assistant") {
      setMessages((current) => [
        ...current,
        { id: createId(), role: "assistant", text: String(value.text || "") },
      ]);
      return;
    }
    if (eventName === "addresses") {
      const next = Array.isArray(data) ? (data as Address[]) : [];
      const nextAddressId = next[0]?.addressId || "";
      if (selectedAddressId && nextAddressId && selectedAddressId !== nextAddressId) clearStoreScopedResults();
      setAddresses(next);
      setSelectedAddressId((current) => current || nextAddressId);
      return;
    }
    if (eventName === "stores") {
      const next = Array.isArray(data) ? (data as Store[]) : [];
      const nextStoreKey = next[0] ? `${next[0].storeCode}:${next[0].beCode}` : "";
      if (selectedStoreKey && nextStoreKey && selectedStoreKey !== nextStoreKey) clearStoreScopedResults();
      setStores(next);
      setSelectedStoreKey((current) => current || nextStoreKey);
      return;
    }
    if (eventName === "menu") {
      setMenu(Array.isArray(data) ? (data as MenuItem[]) : []);
      return;
    }
    if (eventName === "cart") {
      setCart(Array.isArray(data) ? (data as CartItem[]) : []);
      return;
    }
    if (eventName === "meal_detail") {
      const next = parseMealDetail(data);
      if (!next) {
        setError("餐品详情数据格式异常，已安全忽略本次结果");
        return;
      }
      setMealDetail(next);
      return;
    }
    if (eventName === "coupons") {
      if (!Array.isArray(data)) {
        setCoupons([]);
        setError("优惠券数据格式异常，已安全忽略本次结果");
        return;
      }
      setCoupons(parseCoupons(data));
      return;
    }
    if (eventName === "quote" || eventName === "confirmation_required") {
      setQuote(value as unknown as Quote);
      return;
    }
    if (eventName === "order") {
      setOrder(data as Order);
      return;
    }
    if (eventName === "tool") {
      const toolName = String(value.name || "未知工具");
      const status = String(value.status || "running");
      setTimeline((current) => {
        const existing = current.find((item) => item.name === toolName && item.status === "running");
        if (existing) {
          return current.map((item) => item.id === existing.id ? { ...item, status } : item);
        }
        return [...current.slice(-5), { id: createId(), name: toolName, status }];
      });
      return;
    }
    if (eventName === "error") {
      const nested = (value.error && typeof value.error === "object" ? value.error : value) as Record<string, unknown>;
      setError(String(nested.message || "本次操作失败"));
    }
  }

  async function sendMessage(rawText = draft): Promise<void> {
    const text = rawText.trim();
    if (!text || loading) return;
    setDraft("");
    setError("");
    setLoading(true);
    setMessages((current) => [...current, { id: createId(), role: "user", text }]);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sessionId || undefined, message: text }),
      });
      if (!response.ok || !response.body) {
        const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(body.error?.message || "聊天请求失败");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const result = await reader.read();
        buffer += decoder.decode(result.value || new Uint8Array(), { stream: !result.done });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() || "";
        for (const frame of frames) {
          const lines = frame.split(/\r?\n/);
          const eventName = lines.find((line) => line.startsWith("event:"))?.slice(6).trim() || "message";
          const payload = lines.find((line) => line.startsWith("data:"))?.slice(5).trim();
          if (payload) handleEvent(eventName, JSON.parse(payload) as unknown);
        }
        if (result.done) break;
      }
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "聊天请求失败");
    } finally {
      setLoading(false);
    }
  }

  async function chooseContext(addressId: string, store: Store): Promise<void> {
    if (!sessionId) {
      setError("请先发送一句话，让服务端创建会话");
      return;
    }
    setError("");
    try {
      const response = await fetch("/api/context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, addressId, storeCode: store.storeCode, beCode: store.beCode }),
      });
      const body = (await response.json()) as { context?: unknown; error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message || "切换配送门店失败");
      setSelectedAddressId(addressId);
      setSelectedStoreKey(`${store.storeCode}:${store.beCode}`);
      clearStoreScopedResults();
      setQuote(null);
      addAssistant(`已切换到 ${store.storeName}，接下来会按这个门店核价。`);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "切换配送门店失败");
    }
  }

  function viewMealDetail(item: MenuItem): void {
    void sendMessage(`请查看${item.name}的套餐详情和可选规格`);
  }

  function queryCoupons(): void {
    void sendMessage("查询当前门店优惠券");
  }

  async function addToCart(item: MenuItem): Promise<void> {
    setError("");
    try {
      const response = await fetch("/api/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          item: { productCode: item.productCode, productName: item.name, unitPrice: item.price, quantity: 1 },
        }),
      });
      const body = (await response.json()) as { cart?: CartItem[]; error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message || "加入购物车失败");
      setCart(body.cart || []);
      setQuote(null);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "加入购物车失败");
    }
  }

  async function clearCart(): Promise<void> {
    try {
      const response = await fetch("/api/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, action: "clear" }),
      });
      const body = (await response.json()) as { cart?: CartItem[] };
      setCart(body.cart || []);
      setQuote(null);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "清空购物车失败");
    }
  }

  async function confirmOrder(): Promise<void> {
    if (!quote || confirming) return;
    setConfirming(true);
    setError("");
    try {
      const response = await fetch("/api/orders/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, approvalId: quote.approvalId, quoteHash: quote.quoteHash }),
      });
      const body = (await response.json()) as { order?: Order; error?: { code?: string; message?: string } };
      if (!response.ok) {
        if (["APPROVAL_ALREADY_USED", "APPROVAL_NOT_RETRYABLE", "QUOTE_EXPIRED", "QUOTE_HASH_MISMATCH", "QUOTE_INTEGRITY_ERROR"].includes(body.error?.code || "")) {
          setQuote(null);
        }
        throw new Error(body.error?.message || "创建待支付订单失败");
      }
      setOrder(body.order || null);
      setCart([]);
      setQuote(null);
      addAssistant("订单已创建为待支付状态。请在订单卡片中自行打开支付链接；本课程项目不会代替你支付。 ");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "创建待支付订单失败");
    } finally {
      setConfirming(false);
    }
  }

  async function refreshOrder(): Promise<void> {
    if (!order) return;
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(order.orderId)}`);
      const body = (await response.json()) as { order?: Order; error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message || "查询订单状态失败");
      setOrder(body.order || null);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "查询订单状态失败");
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true">M</div>
        <div>
          <div className="eyebrow">问题求解实战 · 小组项目</div>
          <h1>AI 麦乐送助手</h1>
        </div>
        <div className="topbar-status">
          <span className={`status-dot ${health?.mode === "mcd" ? "live" : "mock"}`} />
          {health ? (health.mode === "mcd" ? "官方 MCP 模式" : "Mock 演示模式") : "连接中"}
        </div>
      </header>

      <section className="notice-bar">
        <span className="notice-icon">✦</span>
        <span>课程演示应用 · 创建订单前必须人工确认 · 不保存或代付任何支付信息</span>
        <span className="notice-meta">{health?.modelConfigured ? "在线模型已配置" : "规则演示代理"}</span>
      </section>

      {error && (
        <div className="error-banner" role="alert">
          <span>⚠</span>{error}<button onClick={() => setError("")}>关闭</button>
        </div>
      )}

      <div className="workspace-grid">
        <section className="chat-panel panel-card">
          <div className="panel-heading">
            <div>
              <span className="section-kicker">CONVERSATION</span>
              <h2>和助手说</h2>
            </div>
            <span className="session-label">{sessionId ? `会话 ${sessionId.slice(0, 8)}` : "新会话"}</span>
          </div>

          <div className="chat-log">
            {messages.map((message) => (
              <div className={`message-row ${message.role}`} key={message.id}>
                {message.role === "assistant" && <div className="avatar">M</div>}
                <div className="message-bubble">{message.text}</div>
                {message.role === "user" && <div className="avatar user-avatar">你</div>}
              </div>
            ))}
            {loading && <div className="typing"><span /> <span /> <span /> 助手正在查询工具…</div>}
            <div ref={chatEndRef} />
          </div>

          {timeline.length > 0 && (
            <div className="tool-trace">
              <div className="trace-title">本轮工具调用</div>
              {timeline.map((item) => (
                <div className="trace-item" key={item.id}>
                  <span className={item.status === "success" ? "trace-ok" : item.status === "failed" ? "trace-fail" : "trace-running"}>
                    {item.status === "success" ? "✓" : item.status === "failed" ? "!" : "…"}
                  </span>
                  {readableToolName(item.name)}
                  <span className="trace-status">{item.status === "success" ? "完成" : item.status === "failed" ? "失败" : "处理中"}</span>
                </div>
              ))}
            </div>
          )}

          <div className="quick-prompts">
            {[
              "展示当前菜单",
              "我想吃麦香鸡套餐",
              "帮我核价",
              "查询订单状态",
            ].map((prompt) => <button key={prompt} onClick={() => void sendMessage(prompt)} disabled={loading}>{prompt}</button>)}
          </div>
          <form className="composer" onSubmit={(event) => { event.preventDefault(); void sendMessage(); }}>
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(); }
              }}
              placeholder="比如：我想要一份麦香鸡套餐，帮我看看多少钱"
              rows={2}
              disabled={loading}
            />
            <button className="send-button" type="submit" disabled={loading || !draft.trim()}>{loading ? "处理中" : "发送"}<span>↗</span></button>
          </form>
          <div className="composer-hint">Enter 发送 · Shift + Enter 换行</div>
        </section>

        <aside className="side-column">
           {(addresses.length > 0 || stores.length > 0) && (
             <section className="panel-card context-panel">
               <div className="panel-heading compact"><div><span className="section-kicker">DELIVERY</span><h2>配送信息</h2></div><div className="context-actions"><span className="live-label">● 可配送</span><button className="outline-button" onClick={queryCoupons} disabled={loading || !selectedStore}>查询优惠</button></div></div>
               {selectedAddress && <div className="address-summary"><span className="pin-icon">⌖</span><div><strong>{selectedAddress.contactName} · {selectedAddress.phone}</strong><p>{selectedAddress.fullAddress}</p></div></div>}
               {stores.length > 0 && <div className="store-selector"><span className="sub-label">配送门店</span>{stores.map((store) => <button className={`store-option ${selectedStore?.storeCode === store.storeCode ? "selected" : ""}`} key={`${store.storeCode}:${store.beCode}`} onClick={() => void chooseContext(selectedAddress?.addressId || "", store)}><span>{store.businessStatus ? "营业中" : "暂停售卖"}</span>{store.storeName}<b>{selectedStore?.storeCode === store.storeCode ? "✓" : ""}</b></button>)}</div>}
             </section>
           )}

          {menu.length > 0 && (
            <section className="panel-card menu-panel">
              <div className="panel-heading compact"><div><span className="section-kicker">MENU</span><h2>今日菜单</h2></div><span className="count-label">{menu.length} 款</span></div>
              <div className="menu-list">
                {menu.map((item) => <article className="menu-card" key={item.productCode}><div className="food-visual">{item.category === "小食" ? "🍟" : "🍔"}</div><div className="menu-info"><div className="tag-row">{item.tags.slice(0, 2).map((tag) => <span key={tag}>{tag}</span>)}</div><h3>{item.name}</h3><p>{item.description || "经典餐品，具体以服务端返回菜单为准。"}</p>{typeof item.caloriesKcal === "number" && <small className="nutrition-label">{item.caloriesKcal} 千卡/份</small>}<div className="menu-bottom"><strong>{money(item.price)}</strong><div className="menu-actions"><button className="detail-button" onClick={() => viewMealDetail(item)}>详情</button><button onClick={() => void addToCart(item)}>＋ 加入</button></div></div></div></article>)}
               </div>
             </section>
           )}

           {mealDetail && (
             <section className="panel-card detail-panel">
               <div className="panel-heading compact"><div><span className="section-kicker">MEAL DETAIL</span><h2>套餐详情</h2></div><button className="text-button" onClick={() => setMealDetail(null)}>收起</button></div>
               <div className="detail-content">
                 {mealDetail.image && <img className="detail-image" src={mealDetail.image} alt={`${mealDetail.name}图片`} loading="lazy" />}
                 <div className="detail-title-row"><div><strong>{mealDetail.name}</strong><span>编码 {mealDetail.code}</span></div>{typeof mealDetail.supportModify === "boolean" && <em>{mealDetail.supportModify ? "支持调整" : "固定搭配"}</em>}</div>
                 {mealDetail.description && <p className="detail-description">{mealDetail.description}</p>}
                 {mealDetail.rounds?.map((round, index) => <div className="detail-round" key={`${round.name || "规格"}-${index}`}><span>{round.name || `规格 ${index + 1}`}</span><div>{round.choices.map((choice) => <b key={`${choice.code || choice.name}-${choice.quantity || 1}`}>{choice.name}{choice.quantity && choice.quantity > 1 ? ` ×${choice.quantity}` : ""}</b>)}</div></div>)}
               </div>
             </section>
           )}

           {coupons.length > 0 && (
             <section className="panel-card coupons-panel">
               <div className="panel-heading compact"><div><span className="section-kicker">OFFERS</span><h2>可用优惠</h2></div><button className="text-button" onClick={queryCoupons} disabled={loading}>重新查询</button></div>
               <div className="coupon-list">{coupons.map((coupon) => <article className="coupon-card" key={coupon.couponId}><div className="coupon-badge">券</div><div className="coupon-copy"><strong>{coupon.title}</strong><span>{coupon.couponCode}{coupon.validPeriod ? ` · ${coupon.validPeriod}` : ""}</span>{coupon.products && <small>适用：{coupon.products.map((product) => product.productName).join("、")}</small>}</div></article>)}</div>
             </section>
           )}

           <section className="panel-card cart-panel">
            <div className="panel-heading compact"><div><span className="section-kicker">YOUR ORDER</span><h2>购物车</h2></div><span className="cart-count">{cartCount}</span></div>
            {cart.length === 0 ? <div className="empty-state"><div className="empty-icon">🛒</div><p>还没有选择餐品</p><span>从菜单加入喜欢的食物吧</span></div> : <><div className="cart-list">{cart.map((item) => <div className="cart-row" key={item.productCode}><div><strong>{item.productName}</strong><span>数量 × {item.quantity} · {typeof item.caloriesKcal === "number" ? `${item.caloriesKcal * item.quantity} 千卡` : "热量数据暂无"}</span></div><b>{money(item.unitPrice * item.quantity)}</b></div>)}</div><div className="cart-total"><span>商品小计</span><strong>{money(cartSubtotal)}</strong></div><div className="cart-total nutrition-total"><span>预计总热量</span><strong>{typeof cartCalories === "number" ? `${cartCalories} 千卡` : "数据不全"}</strong></div><div className="cart-actions"><button className="text-button" onClick={() => void clearCart()}>清空</button><button className="primary-button" onClick={() => void sendMessage("请核价当前购物车")}>开始核价 <span>→</span></button></div></>}
          </section>

          {quote && (
            <section className="panel-card quote-panel confirmation-card">
              <div className="confirm-ribbon">需要你的确认</div>
              <div className="panel-heading compact"><div><span className="section-kicker">PRICE CHECK</span><h2>核价确认</h2></div><span className="expires">{new Date(quote.expiresAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })} 前有效</span></div>
              <div className="quote-context"><p>配送至：{quote.context.address.fullAddress}</p><p>门店：{quote.context.storeName}</p></div>
              <div className="quote-lines">{quote.items.map((item) => <div key={item.productCode}><span>{item.productName} × {item.quantity}</span><b>{money(item.unitPrice * item.quantity)}</b></div>)}<div><span>配送费</span><b>{money(quote.deliveryPrice)}</b></div>{quote.discount > 0 && <div className="discount-line"><span>优惠</span><b>-{money(quote.discount)}</b></div>}</div>
              <div className="grand-total"><span>应付总额</span><strong>{money(quote.totalPrice)}</strong></div>
              <button className="confirm-button" onClick={() => void confirmOrder()} disabled={confirming}>{confirming ? "正在创建…" : "确认并创建待支付订单"}<span>→</span></button>
              <p className="safety-note">点击后只创建待支付订单，不会自动完成支付。</p>
            </section>
          )}

          {order && (
            <section className="panel-card order-panel">
              <div className="panel-heading compact"><div><span className="section-kicker">ORDER TRACKING</span><h2>订单状态</h2></div><button className="refresh-button" onClick={() => void refreshOrder()}>↻ 刷新</button></div>
              <div className="order-id">订单号 <strong>{order.orderId}</strong></div>
              <div className="order-status"><span className="status-pulse" />{order.orderStatus}<b>{money(order.totalAmount)}</b></div>
              {order.deliveryAddress && <p className="order-address">送至：{order.deliveryAddress}</p>}
              {order.payH5Url && <a className="pay-link" href={order.payH5Url} target="_blank" rel="noreferrer">打开支付链接 <span>↗</span></a>}
              <p className="safety-note">支付由用户自行操作，演示应用不会读取支付信息。</p>
            </section>
          )}
        </aside>
      </div>

      <footer className="footer"><span>AI 麦乐送助手 · 四人小组课程项目</span><span>协议 {health?.protocolVersion || "2025-06-18"} · {health?.provider || "等待服务端"}</span></footer>
    </main>
  );
}
