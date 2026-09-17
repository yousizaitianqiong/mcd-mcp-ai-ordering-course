"""生成 AI 麦乐送助手正式系统需求分析说明书。

本脚本以当前项目源码和 Markdown 文档为事实来源，以往届需求分析文档为
信息架构参考。图示在临时目录中本地生成并嵌入 DOCX，不把参考文档素材带入
项目。
"""

from pathlib import Path
import shutil
import tempfile

from PIL import Image, ImageDraw, ImageFont
from docx import Document
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt

from build_discussion_doc import (
    BLACK,
    BLUE,
    GREEN,
    INK,
    LINE,
    MUTED,
    PALE_BLUE,
    add_heading,
    add_label_paragraph,
    add_link_line,
    add_paragraph,
    add_table,
    add_text,
    clear_paragraph,
    set_style_font,
    setup_document,
)


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "AI麦乐送助手_课程项目组名单与简要用户需求列表.docx"
DOC_NUMBER = "MCD-SRS-0001"
VERSION = "2.0"


def add_label_paragraph(doc, label, text):
    paragraph = doc.add_paragraph()
    paragraph.paragraph_format.space_after = Pt(6)
    paragraph.paragraph_format.line_spacing = 1.22
    if not text:
        paragraph.paragraph_format.keep_with_next = True
    add_text(paragraph, f"{label}：", size=10.5, bold=True, color=BLUE)
    if text:
        add_text(paragraph, text, size=10.5)
    return paragraph


def add_heading3(doc, text):
    paragraph = doc.add_paragraph(style="Heading 3")
    paragraph.paragraph_format.keep_with_next = True
    paragraph.paragraph_format.space_before = Pt(8)
    paragraph.paragraph_format.space_after = Pt(3)
    add_text(paragraph, text, size=10.8, bold=True, color=BLACK)
    return paragraph


def add_page_field(paragraph):
    add_text(paragraph, "问题求解实战课程项目  |  MCD-SRS-0001  |  第 ", size=8.2, color=MUTED)
    run = paragraph.add_run()
    begin = OxmlElement("w:fldChar")
    begin.set(qn("w:fldCharType"), "begin")
    instruction = OxmlElement("w:instrText")
    instruction.set(qn("xml:space"), "preserve")
    instruction.text = " PAGE "
    separate = OxmlElement("w:fldChar")
    separate.set(qn("w:fldCharType"), "separate")
    text_node = OxmlElement("w:t")
    text_node.text = "1"
    end = OxmlElement("w:fldChar")
    end.set(qn("w:fldCharType"), "end")
    run._r.extend([begin, instruction, separate, text_node, end])
    add_text(paragraph, " 页", size=8.2, color=MUTED)


def configure_document(doc):
    setup_document(doc)
    if "Heading 3" in doc.styles:
        set_style_font(doc.styles["Heading 3"], size=10.8, bold=True, color=BLACK)

    section = doc.sections[0]
    header = section.header.paragraphs[0]
    clear_paragraph(header)
    header.alignment = WD_ALIGN_PARAGRAPH.CENTER
    header.paragraph_format.space_after = Pt(0)
    add_text(header, "AI 麦乐送助手  |  系统需求分析说明书", size=8.5, color=MUTED)

    footer = section.footer.paragraphs[0]
    clear_paragraph(footer)
    footer.alignment = WD_ALIGN_PARAGRAPH.CENTER
    footer.paragraph_format.space_before = Pt(0)
    add_page_field(footer)

    doc.core_properties.title = "AI 麦乐送助手系统需求分析说明书"
    doc.core_properties.subject = "问题求解实战课程小组项目系统需求分析"
    doc.core_properties.author = "AI 麦乐送助手小组"
    doc.core_properties.comments = "依据当前项目源码和项目文档编制；往届文档仅作为结构参考。"


def add_picture(doc, image_path, caption):
    paragraph = doc.add_paragraph()
    paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    paragraph.paragraph_format.space_before = Pt(3)
    paragraph.paragraph_format.space_after = Pt(2)
    paragraph.add_run().add_picture(str(image_path), width=Inches(6.45))
    caption_paragraph = doc.add_paragraph()
    caption_paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    caption_paragraph.paragraph_format.space_after = Pt(7)
    add_text(caption_paragraph, caption, size=8.8, color=MUTED, italic=True)


def add_bullets(doc, items):
    for item in items:
        paragraph = doc.add_paragraph(style="List Bullet")
        paragraph.paragraph_format.left_indent = Inches(0.3)
        paragraph.paragraph_format.first_line_indent = Inches(-0.15)
        paragraph.paragraph_format.space_after = Pt(3)
        paragraph.paragraph_format.line_spacing = 1.16
        add_text(paragraph, item, size=10.1, color=INK)


def add_numbered(doc, items):
    for index, item in enumerate(items, start=1):
        paragraph = doc.add_paragraph()
        paragraph.paragraph_format.left_indent = Inches(0.28)
        paragraph.paragraph_format.first_line_indent = Inches(-0.28)
        paragraph.paragraph_format.space_after = Pt(3)
        paragraph.paragraph_format.line_spacing = 1.16
        add_text(paragraph, f"{index}. ", size=10.1, bold=True, color=BLUE)
        add_text(paragraph, item, size=10.1, color=INK)


def rgb(hex_color):
    return tuple(int(hex_color[index:index + 2], 16) for index in (0, 2, 4))


def diagram_font(size, bold=False):
    candidates = [
        Path(r"C:\Windows\Fonts\msyhbd.ttc") if bold else Path(r"C:\Windows\Fonts\msyh.ttc"),
        Path(r"C:\Windows\Fonts\simhei.ttf") if bold else Path(r"C:\Windows\Fonts\simsun.ttc"),
        Path(r"C:\Windows\Fonts\arial.ttf"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size=size)
    return ImageFont.load_default()


def wrapped_lines(draw, text, font, max_width):
    lines = []
    for paragraph in str(text).split("\n"):
        current = ""
        for char in paragraph:
            candidate = current + char
            if not current or draw.textlength(candidate, font=font) <= max_width:
                current = candidate
            else:
                lines.append(current)
                current = char
        if current:
            lines.append(current)
    return lines or [""]


def draw_text_center(draw, box, text, font, fill, max_lines=None):
    left, top, right, bottom = box
    lines = wrapped_lines(draw, text, font, right - left - 26)
    if max_lines and len(lines) > max_lines:
        lines = lines[:max_lines]
        lines[-1] = lines[-1][:-1] + "…"
    line_height = max(24, int(font.size * 1.28))
    total_height = line_height * len(lines)
    y = top + (bottom - top - total_height) / 2
    for line in lines:
        width = draw.textlength(line, font=font)
        draw.text(((left + right - width) / 2, y), line, font=font, fill=fill)
        y += line_height


def draw_box(draw, box, text, fill=(234, 242, 248), outline=(31, 78, 121), font=None):
    draw.rounded_rectangle(box, radius=18, fill=fill, outline=outline, width=4)
    draw_text_center(draw, box, text, font or diagram_font(32), rgb("24211F"))


def draw_arrow(draw, start, end, fill=(31, 78, 121), width=5):
    draw.line([start, end], fill=fill, width=width)
    x1, y1 = start
    x2, y2 = end
    if abs(x2 - x1) >= abs(y2 - y1):
        if x2 >= x1:
            head = [(x2, y2), (x2 - 18, y2 - 11), (x2 - 18, y2 + 11)]
        else:
            head = [(x2, y2), (x2 + 18, y2 - 11), (x2 + 18, y2 + 11)]
    elif y2 >= y1:
        head = [(x2, y2), (x2 - 11, y2 - 18), (x2 + 11, y2 - 18)]
    else:
        head = [(x2, y2), (x2 - 11, y2 + 18), (x2 + 11, y2 + 18)]
    draw.polygon(head, fill=fill)


def draw_title(draw, title, subtitle, width):
    title_font = diagram_font(46, bold=True)
    subtitle_font = diagram_font(26)
    title_width = draw.textlength(title, font=title_font)
    draw.text(((width - title_width) / 2, 34), title, font=title_font, fill=rgb("000000"))
    subtitle_width = draw.textlength(subtitle, font=subtitle_font)
    draw.text(((width - subtitle_width) / 2, 95), subtitle, font=subtitle_font, fill=rgb("6F6862"))


def make_activity(path, title, subtitle, steps, note):
    width = 1800
    height = max(850, 210 + len(steps) * 145)
    image = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(image)
    draw_title(draw, title, subtitle, width)
    box_font = diagram_font(34)
    box_width = 1320
    left = (width - box_width) // 2
    box_height = 96
    start_y = 165
    for index, step in enumerate(steps):
        top = start_y + index * 135
        draw_box(
            draw,
            (left, top, left + box_width, top + box_height),
            step,
            fill=rgb("EAF2F8") if index % 2 == 0 else rgb("F7F8F9"),
            font=box_font,
        )
        if index < len(steps) - 1:
            draw_arrow(
                draw,
                (width // 2, top + box_height + 5),
                (width // 2, top + 130),
            )
    note_font = diagram_font(24)
    note_lines = wrapped_lines(draw, note, note_font, width - 220)
    y = height - 54
    for line in note_lines[:2]:
        line_width = draw.textlength(line, font=note_font)
        draw.text(((width - line_width) / 2, y), line, font=note_font, fill=rgb("6F6862"))
        y += 30
    image.save(path)


def make_module(path, title, subtitle, steps, note):
    make_activity(path, title, subtitle, steps, note)


def make_system_overview(path):
    width, height = 2000, 1100
    image = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(image)
    draw_title(draw, "系统总体功能 / 用例图", "点餐用户通过 Web API 使用 AI 麦乐送助手；外部能力由服务端统一适配", width)

    system_box = (570, 150, 1430, 930)
    draw.rounded_rectangle(system_box, radius=25, outline=rgb("1F4E79"), width=5, fill=rgb("FBFCFD"))
    label_font = diagram_font(30, bold=True)
    draw.text((620, 180), "AI 麦乐送助手", font=label_font, fill=rgb("1F4E79"))

    usecases = [
        "自然语言点餐会话",
        "选择配送地址与门店",
        "查看菜单、详情与优惠",
        "维护购物车并发起核价",
        "人工确认并创建待支付订单",
        "查询订单状态",
    ]
    box_font = diagram_font(28)
    x1, x2 = 700, 1300
    y = 245
    positions = []
    for index, item in enumerate(usecases):
        x = x1 if index % 2 == 0 else x2
        row = index // 2
        top = y + row * 190
        box = (x - 235, top, x + 235, top + 105)
        positions.append(box)
        draw_box(draw, box, item, fill=rgb("EAF2F8"), font=box_font)

    actor_box = (80, 440, 430, 590)
    draw_box(draw, actor_box, "点餐用户", fill=rgb("F7F8F9"), font=diagram_font(34, bold=True))
    for box in positions:
        draw_arrow(draw, (actor_box[2], (actor_box[1] + actor_box[3]) // 2), (box[0], (box[1] + box[3]) // 2), fill=rgb("6F6862"), width=3)

    model_box = (1510, 230, 1900, 380)
    provider_box = (1510, 485, 1900, 635)
    audit_box = (1510, 740, 1900, 890)
    for box, text in [
        (model_box, "模型适配 / Mock Agent"),
        (provider_box, "MCP Provider / Mock"),
        (audit_box, "JsonStore / 脱敏审计"),
    ]:
        draw_box(draw, box, text, fill=rgb("F7F8F9"), font=diagram_font(27))
    for source in positions:
        center_y = (source[1] + source[3]) // 2
        if center_y < 500:
            target = model_box
        elif center_y < 700:
            target = provider_box
        else:
            target = audit_box
        draw_arrow(draw, (source[2], center_y), (target[0], (target[1] + target[3]) // 2), fill=rgb("6F6862"), width=3)

    note_font = diagram_font(25)
    note = "关键约束：create-order 不在模型工具白名单中，只能由用户点击确认按钮后由服务端调用。"
    note_width = draw.textlength(note, font=note_font)
    draw.text(((width - note_width) / 2, 1015), note, font=note_font, fill=rgb("A51E32"))
    image.save(path)


def make_sequence(path):
    width, height = 1900, 1160
    image = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(image)
    draw_title(draw, "核价—人工确认—订单创建时序图", "服务端在第一次异步写操作前原子领取批准记录，并只调用一次 create-order", width)
    participants = [
        ("浏览器", 170),
        ("HTTP API", 510),
        ("编排器", 900),
        ("Provider", 1300),
        ("外部订单服务", 1680),
    ]
    participant_font = diagram_font(27, bold=True)
    for name, x in participants:
        box = (x - 120, 155, x + 120, 235)
        draw_box(draw, box, name, fill=rgb("EAF2F8"), font=participant_font)
        draw.line((x, 235, x, 1030), fill=rgb("B9C3CB"), width=3)

    messages = [
        (285, 0, 1, "POST /api/orders/confirm"),
        (395, 1, 2, "校验 sessionId / approvalId / quoteHash"),
        (505, 2, 2, "复核报价完整性、有效期与会话归属"),
        (615, 2, 2, "原子 claim：pending → submitting"),
        (725, 2, 3, "记录审计并调用 createOrder 一次"),
        (835, 3, 4, "创建待支付订单"),
        (945, 4, 3, "返回订单号 / 状态"),
        (1055, 3, 2, "保存成功、失败或 unknown 状态"),
    ]
    message_font = diagram_font(23)
    for y, source_index, target_index, label in messages:
        x1 = participants[source_index][1]
        x2 = participants[target_index][1]
        draw_arrow(draw, (x1, y), (x2, y), fill=rgb("1F4E79"), width=4)
        label_width = draw.textlength(label, font=message_font)
        draw.text(((x1 + x2 - label_width) / 2, y - 35), label, font=message_font, fill=rgb("24211F"))
    image.save(path)


USE_CASES = [
    {
        "id": "MCD-SRS-1.1.0",
        "title": "自然语言点餐会话",
        "usr": "MCD-USR-0001",
        "description": "用户用自然语言表达餐品、数量、预算或优惠需求，系统创建或恢复会话，并通过模型或规则式 Mock Agent 编排查询类工具。",
        "actor": "点餐用户、Web 前端、ModelAdapter 或 Mock Agent",
        "pre": "服务已启动；请求包含有效消息；可使用在线模型，或使用无外部依赖的 Mock Agent。",
        "post": "会话消息和脱敏审计摘要被保存；返回助手回复和结构化事件；不产生订单写操作。",
        "input": "sessionId（可选）、中文 message（必填，长度不超过接口限制）。",
        "output": "session、tool、addresses、stores、menu、meal_detail、coupons、cart、quote、confirmation_required、assistant、error、done 等 SSE 事件。",
        "events": ["接收并校验消息。", "创建或恢复会话。", "模型或 Mock Agent 解析用户意图。", "只调用白名单工具并传递工具结果。", "以中文回复并结束本次 SSE 流。"],
        "errors": ["消息为空或超过长度限制时返回 MESSAGE_REQUIRED 或输入校验错误。", "模型未配置时使用 Mock Agent；模型调用失败时返回脱敏错误。"],
        "acceptance": "AC-001、AC-002；证据为健康检查、SSE 事件、助手回复和页面录屏。",
        "diagram": "activity-1-1.png",
    },
    {
        "id": "MCD-SRS-1.2.0",
        "title": "配送地址与门店选择",
        "usr": "MCD-USR-0002",
        "description": "系统先查询配送地址，再根据用户选择的地址查询可配送门店；用户选择后形成后续菜单和核价使用的订单上下文。",
        "actor": "点餐用户、Web 前端、FoodOrderProvider",
        "pre": "会话存在；Provider 可返回地址或显式返回 Mock 地址。",
        "post": "服务端保存 addressId、storeCode、beCode、storeName 和展示地址；门店已验证属于所选配送地址。",
        "input": "sessionId、addressId、storeCode。",
        "output": "地址列表、门店列表、context 响应和上下文事件。",
        "events": ["调用 listAddresses。", "用户选择地址。", "调用 listDeliverableStores(address)。", "用户选择门店。", "服务端重新校验并保存上下文。"],
        "errors": ["地址不存在、门店不属于地址或远端查询失败时拒绝保存，并返回友好提示。"],
        "acceptance": "AC-002、AC-003；证据为地址/门店卡片、/api/context 响应和工具轨迹。",
        "diagram": "activity-1-2.png",
    },
    {
        "id": "MCD-SRS-1.3.0",
        "title": "菜单与餐品详情",
        "usr": "MCD-USR-0003",
        "description": "用户查看当前门店菜单、价格、标签、分类和可用餐品详情；浏览器只接收经过白名单转换的字段。",
        "actor": "点餐用户、Web 前端、FoodOrderProvider",
        "pre": "已选择有效地址和门店。",
        "post": "页面展示当前门店的菜单或指定餐品详情；不会因为浏览而产生外部写操作。",
        "input": "sessionId、storeCode、beCode、productCode（详情查询时）。",
        "output": "menu 和 meal_detail 事件，包含名称、价格、标签、说明以及可用的规格选项。",
        "events": ["查询 listMeals。", "展示菜单卡片。", "用户请求详情时调用 getMealDetail。", "将结果转换为浏览器允许的结构。"],
        "errors": ["门店未选择、餐品不存在或字段结构不符合白名单时停止展示并提示。"],
        "acceptance": "AC-003；证据为菜单卡片、详情卡片和结构化事件。",
        "diagram": "activity-1-3.png",
    },
    {
        "id": "MCD-SRS-1.4.0",
        "title": "门店优惠券查询",
        "usr": "MCD-USR-0003、MCD-USR-0005",
        "description": "用户可以查看当前门店可用的优惠券或优惠信息，核价时由服务端根据选定上下文处理优惠金额。",
        "actor": "点餐用户、Web 前端、FoodOrderProvider",
        "pre": "已选择有效门店；Provider 支持优惠券查询或返回明确的空结果。",
        "post": "页面展示脱敏优惠券信息；优惠券查询本身不创建订单。",
        "input": "sessionId、storeCode、beCode。",
        "output": "coupons 事件，包含 couponId、couponCode、title 和可用期限/适用商品等白名单字段。",
        "events": ["确认门店上下文。", "调用 listStoreCoupons。", "转换并展示优惠信息。", "在核价阶段由服务端决定是否传递选定优惠。"],
        "errors": ["查询失败时保留原始错误分类，不把未知优惠包装成可用优惠。"],
        "acceptance": "AC-009；证据为优惠券事件、页面卡片和核价数据。",
        "diagram": "activity-1-4.png",
    },
    {
        "id": "MCD-SRS-1.5.0",
        "title": "购物车维护",
        "usr": "MCD-USR-0004",
        "description": "用户将当前菜单餐品加入购物车，重复加入时合并数量，查看商品小计，也可以清空购物车。",
        "actor": "点餐用户、Web 前端、HTTP API",
        "pre": "已选择门店；加入的 productCode 必须存在于服务端重新查询的当前菜单。",
        "post": "服务端保存购物车；数量限制为 1～20；购物车事件反映当前餐品和小计。",
        "input": "sessionId、productCode、quantity 或 clear 操作。",
        "output": "cart 事件、餐品数量、商品小计和可用营养字段。",
        "events": ["前端提交加入或清空请求。", "服务端重新查询菜单并验证餐品。", "同商品合并数量。", "保存状态并返回购物车。"],
        "errors": ["空购物车、失效餐品、数量越界或上下文缺失时返回稳定错误码。"],
        "acceptance": "AC-003、AC-004；证据为页面状态和请求响应。",
        "diagram": "activity-1-5.png",
    },
    {
        "id": "MCD-SRS-1.6.0",
        "title": "核价与报价展示",
        "usr": "MCD-USR-0005",
        "description": "系统使用服务端保存的地址、门店和购物车调用 Provider 核价，并展示商品金额、配送费、优惠、总价、币种和有效期。",
        "actor": "点餐用户、OrderingOrchestrator、FoodOrderProvider",
        "pre": "订单上下文完整且购物车至少有一件有效餐品。",
        "post": "服务端保存待确认报价、报价内容、expiresAt 和 quoteHash；仍未调用 create-order。",
        "input": "sessionId、当前上下文、购物车及可选 coupon。",
        "output": "PriceQuote、quoteId、商品价、配送费、优惠、总价、CNY、expiresAt、quoteHash 和 confirmation_required 事件。",
        "events": ["读取服务端上下文和购物车。", "调用 calculatePrice。", "校验金额单位和报价结构。", "生成或保存报价哈希。", "向用户展示确认内容。"],
        "errors": ["上下文缺失、购物车为空、金额结构异常或报价过期时拒绝进入确认。"],
        "acceptance": "AC-004、AC-009；证据为报价卡片、SSE quote 和报价哈希。",
        "diagram": "activity-1-6.png",
    },
    {
        "id": "MCD-SRS-1.7.0",
        "title": "人工确认与订单创建",
        "usr": "MCD-USR-0006",
        "description": "只有用户在页面检查地址、门店、商品和总价后点击确认，服务端才允许创建待支付订单。",
        "actor": "点餐用户、Web 前端、HTTP API、FoodOrderProvider",
        "pre": "存在属于当前会话的 pending 报价；报价未过期且 quoteHash 与服务端快照一致。",
        "post": "成功时生成待支付订单并清理购物车；失败或未知时保存对应状态，不自动重试。",
        "input": "sessionId、approvalId、quoteHash。",
        "output": "PendingOrder、订单号、订单状态、可选支付链接和 order 事件。",
        "events": ["页面提交确认。", "服务端校验会话归属、报价完整性、哈希和有效期。", "原子领取批准记录。", "记录审计并调用 createOrder 一次。", "保存订单结果并返回页面。"],
        "errors": ["重复确认、报价过期、哈希不匹配、外部超时/网络错误或未知写入结果时停止自动重试。"],
        "acceptance": "AC-005、AC-006；证据为确认请求、订单卡片和审计事件。",
        "diagram": "activity-1-7.png",
    },
    {
        "id": "MCD-SRS-1.8.0",
        "title": "待支付链接与订单状态",
        "usr": "MCD-USR-0007",
        "description": "用户获得待支付订单号和状态，并可以刷新状态；应用不保存支付密码、银行卡或支付 Token，也不自动支付。",
        "actor": "点餐用户、Web 前端、FoodOrderProvider",
        "pre": "订单已创建或已有可查询的订单号。",
        "post": "页面展示必要的订单状态；重复刷新只查询状态，不再次创建订单。",
        "input": "orderId 或订单卡片中的订单标识。",
        "output": "orderId、orderStatus、totalAmount、storeName、deliveryAddress 脱敏展示和可选 payH5Url。",
        "events": ["读取本地已保存订单。", "必要时调用 getOrderStatus。", "更新页面订单状态。", "将支付动作交给用户。"],
        "errors": ["订单号为空、订单不存在或查询失败时返回友好提示。"],
        "acceptance": "AC-007、AC-008；证据为订单卡片、状态响应和演示记录。",
        "diagram": "activity-1-8.png",
    },
    {
        "id": "MCD-SRS-1.9.0",
        "title": "Mock 演示模式",
        "usr": "MCD-USR-0008",
        "description": "没有 MCP Token、在线网络或真实账号时，系统使用显式标注的 Mock Provider 完成课堂演示闭环。",
        "actor": "课堂演示者、Web 前端、MockFoodOrderProvider",
        "pre": "APP_MODE=mock，或启动配置因缺少 MCP Token 明确回退为 Mock。",
        "post": "地址、门店、菜单、购物车、核价、模拟待支付订单和状态查询均可重复演示。",
        "input": "课堂演示消息、地址/门店选择、菜单和确认操作。",
        "output": "health 中的 mode=mock/provider=mock、Mock 数据和明确标记的模拟订单。",
        "events": ["启动 Mock Provider。", "按与真实 Provider 相同的接口完成查询。", "展示 Mock 标识。", "生成模拟待支付状态，不伪装成真实订单。"],
        "errors": ["Mock 数据异常时返回本地错误，不静默声称已完成真实下单。"],
        "acceptance": "AC-001、AC-008；证据为健康检查、页面截图和 Mock 测试。",
        "diagram": "activity-1-9.png",
    },
    {
        "id": "MCD-SRS-2.1.0",
        "title": "密钥、个人信息和支付信息隔离",
        "usr": "MCD-USR-0009",
        "description": "MCP Token、模型 API Key、Authorization Header 和支付信息只在服务端受控范围内使用，不进入浏览器、仓库、日志或明文状态文件。",
        "actor": "系统维护者、HTTP API、JsonStore",
        "pre": "服务端通过环境变量读取配置；浏览器仅调用本项目 HTTP API。",
        "post": "浏览器响应和源码无密钥；持久化状态、日志和审计内容经过脱敏；支付信息不被应用读取。",
        "input": "服务端环境变量、地址和订单响应。",
        "output": "脱敏地址、脱敏订单和审计摘要；health 只返回配置状态，不返回 Token。",
        "events": ["服务端读取环境变量。", "不把密钥放入模型工具参数或前端响应。", "safeState 脱敏地址和订单字段。", "redactText 处理日志和审计摘要。"],
        "errors": ["发现敏感值进入浏览器、日志或数据文件时立即标记安全失败。"],
        "acceptance": "AC-010；证据为 Network、源码、日志和 data/app-state.json 检查。",
        "diagram": "activity-2-1.png",
    },
    {
        "id": "MCD-SRS-2.2.0",
        "title": "一次性确认、审计与禁止自动重试",
        "usr": "MCD-USR-0006；源自原 Word 0014 的系统约束",
        "description": "订单写操作必须经过一次性批准记录和审计；在外部服务超时、网络错误或未知写入结果后，系统不自动重试。",
        "actor": "HTTP API、OrderingOrchestrator、JsonStore、FoodOrderProvider",
        "pre": "存在 pending approval；服务端能够计算报价完整性和 quoteHash。",
        "post": "批准记录进入 confirmed、failed 或 unknown；每次确认最多调用一次 createOrder；审计事件保留脱敏摘要。",
        "input": "approvalId、sessionId、quoteHash 及外部 Provider 返回结果。",
        "output": "订单状态、错误分类和审计事件。",
        "events": ["原子检查并领取 pending approval。", "记录 create_order_attempt。", "调用 Provider 一次。", "按结果保存 confirmed/failed/unknown。", "向用户说明人工处理或重新核对要求。"],
        "errors": ["已使用、非 pending、过期、哈希不匹配、超时和未知结果均不可自动重试。"],
        "acceptance": "AC-005、AC-006、AC-011；证据为测试输出、审计状态和重复点击结果。",
        "diagram": "activity-2-2.png",
    },
    {
        "id": "MCD-SRS-3.1.0",
        "title": "工具调用进度展示",
        "usr": "MCD-USR-0010",
        "description": "用户可以看到地址、门店、菜单、餐品详情、优惠券、购物车和核价等工具调用的运行状态及结构化结果。",
        "actor": "点餐用户、Web 前端、SSE 服务",
        "pre": "聊天请求建立 SSE 连接；服务端产生工具开始、成功或失败事件。",
        "post": "页面按顺序展示工具进度、结果卡片和最终助手回复。",
        "input": "聊天消息和工具执行状态。",
        "output": "tool 事件以及 addresses、stores、menu、meal_detail、coupons、cart、quote 等结构化事件。",
        "events": ["建立 SSE。", "发送工具开始事件。", "发送工具结果或失败事件。", "更新页面卡片。", "发送 assistant 和 done。"],
        "errors": ["事件结构不在前端白名单内时丢弃或转为安全错误。"],
        "acceptance": "AC-002、AC-009；证据为 SSE 记录和页面录屏。",
        "diagram": "activity-3-1.png",
    },
    {
        "id": "MCD-SRS-3.2.0",
        "title": "友好异常处理",
        "usr": "MCD-USR-0011",
        "description": "系统将配置缺失、鉴权失败、限流、超时、空地址、无门店、失效餐品、报价过期和重复确认转换为稳定错误码与中文提示。",
        "actor": "点餐用户、HTTP API、ModelAdapter、MCP Client",
        "pre": "输入错误或外部服务异常被分类；服务端不向页面泄露内部凭据和堆栈。",
        "post": "用户得到可操作的中文提示；审计记录脱敏；写操作不会因为错误自动重试。",
        "input": "非法请求、Provider 错误、模型错误或状态冲突。",
        "output": "错误码、中文提示、可选恢复建议和 error SSE 事件。",
        "events": ["捕获并分类错误。", "保留稳定错误码。", "脱敏日志和页面消息。", "提示用户修正输入、重新核对或切回 Mock。"],
        "errors": ["未知错误按安全失败处理，不把未知结果当成成功。"],
        "acceptance": "AC-011；证据为错误响应、测试输出和脱敏日志。",
        "diagram": "activity-3-2.png",
    },
    {
        "id": "MCD-SRS-4.1.0",
        "title": "接口契约与团队协作追踪",
        "usr": "MCD-USR-0012",
        "description": "需求、用户故事、系统接口、SSE 事件、Provider、测试标准和成员职责保持可追踪，支持四人并行开发和课程交付。",
        "actor": "四人项目小组、教师、维护者",
        "pre": "项目代码、需求 Markdown、架构说明、测试计划和分工表位于同一项目基线。",
        "post": "每条用户需求对应系统需求和验收标准；接口变化可定位到文档和负责人。",
        "input": "需求编号、接口字段、测试用例、成员职责和变更记录。",
        "output": "需求追踪矩阵、文档链接、测试证据位置和修订记录。",
        "events": ["以 requirements.md 冻结用户需求和 AC。", "从源码核对 API、类型和状态。", "将 SRS 映射到测试与演示证据。", "记录文档修订和未完成真实联调事项。"],
        "errors": ["接口或编号不一致时阻止交付，不能用计划内容替代测试事实。"],
        "acceptance": "AC-012；证据为 Markdown 交叉引用、分工表和审查清单。",
        "diagram": "activity-4-1.png",
    },
]


def create_diagrams(asset_dir):
    asset_dir.mkdir(parents=True, exist_ok=True)
    paths = {}
    overview = asset_dir / "system-overview.png"
    make_system_overview(overview)
    paths["system-overview.png"] = overview
    sequence = asset_dir / "confirmation-sequence.png"
    make_sequence(sequence)
    paths["confirmation-sequence.png"] = sequence

    module_flows = [
        ("module-1.png", "模块一：智能会话与会话状态", "自然语言输入经过模型或 Mock Agent，输出结构化 SSE 事件", ["用户输入消息", "HTTP API 校验并建立会话", "ModelAdapter / Mock Agent", "白名单工具调用", "助手回复与 done"], "模型不拥有 create-order 权限。"),
        ("module-2.png", "模块二：配送上下文", "地址决定可配送门店，服务端负责重新校验", ["查询配送地址", "用户选择地址", "查询可配送门店", "用户选择门店", "保存 OrderContext"], "门店不能由模型猜测或脱离地址直接提交。"),
        ("module-3.png", "模块三：菜单、优惠券与购物车", "浏览器使用服务端白名单字段，购物车由服务端维护", ["查询菜单", "查询餐品详情", "查询门店优惠券", "加入或合并餐品", "查看或清空购物车"], "加入购物车前重新验证当前菜单和数量范围。"),
        ("module-4.png", "模块四：核价与订单生命周期", "核价形成待确认报价，人工确认后才触发外部写操作", ["读取上下文和购物车", "Provider 核价", "保存 quoteHash 与有效期", "用户点击确认", "创建待支付订单并查询状态"], "过期、篡改或重复确认均拒绝写操作。"),
        ("module-5.png", "模块五：演示、安全与协作保障", "Mock、脱敏、审计和文档追踪共同支撑课程交付", ["显式 Mock 回退", "服务端保管凭据", "脱敏持久化与审计", "错误分类和人工处理", "需求—测试—分工追踪"], "真实 MCP 缺少凭据时记录阻塞，不用 Mock 结果替代。"),
    ]
    for filename, title, subtitle, steps, note in module_flows:
        target = asset_dir / filename
        make_module(target, title, subtitle, steps, note)
        paths[filename] = target

    for case in USE_CASES:
        target = asset_dir / case["diagram"]
        make_activity(
            target,
            f'{case["id"]}  {case["title"]}',
            "活动流：输入 → 服务端校验 → Provider/模型处理 → 结构化输出",
            case["events"],
            f'验收依据：{case["acceptance"]}',
        )
        paths[case["diagram"]] = target
    return paths


def add_use_case(doc, case, image_path):
    add_heading3(doc, f'{case["id"]}  {case["title"]}')
    add_label_paragraph(doc, "用例描述", case["description"])
    add_label_paragraph(doc, "对应用户需求", case["usr"])
    add_table(
        doc,
        ["项目", "内容"],
        [
            ["参与者", case["actor"]],
            ["前置条件", case["pre"]],
            ["后置条件", case["post"]],
            ["输入数据", case["input"]],
            ["输出数据", case["output"]],
        ],
        [1.25, 5.65],
        font_size=8.65,
    )
    add_label_paragraph(doc, "事件流", "")
    add_numbered(doc, case["events"])
    add_label_paragraph(doc, "异常处理", "")
    add_bullets(doc, case["errors"])
    add_label_paragraph(doc, "验收证据", case["acceptance"])
    add_picture(doc, image_path, f'图 3.{case["id"].split("-")[-1]} {case["title"]}活动图')


def build_document():
    asset_dir = Path(tempfile.mkdtemp(prefix="mcd-srs-diagrams-"))
    try:
        diagram_paths = create_diagrams(asset_dir)
        doc = Document()
        configure_document(doc)

        # 封面与修订记录
        top = doc.add_paragraph()
        top.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        top.paragraph_format.space_after = Pt(30)
        add_text(top, DOC_NUMBER, size=11, bold=True, color=BLUE)

        title = doc.add_paragraph(style="Title")
        title.alignment = WD_ALIGN_PARAGRAPH.CENTER
        title.paragraph_format.space_before = Pt(25)
        title.paragraph_format.space_after = Pt(14)
        add_text(title, "AI 麦乐送助手", size=27, bold=True, color=BLACK)

        subtitle = doc.add_paragraph()
        subtitle.alignment = WD_ALIGN_PARAGRAPH.CENTER
        subtitle.paragraph_format.space_after = Pt(35)
        add_text(subtitle, "系统需求分析说明书", size=18, bold=True, color=BLUE)

        cover_note = doc.add_paragraph()
        cover_note.alignment = WD_ALIGN_PARAGRAPH.CENTER
        cover_note.paragraph_format.space_after = Pt(27)
        add_text(cover_note, "问题求解实战课程小组项目", size=12, color=MUTED)

        add_table(
            doc,
            ["文档编号", "版本", "小组名称", "指导教师"],
            [[DOC_NUMBER, VERSION, "AI 麦乐送助手小组", "陈正茂"]],
            [1.5, 1.0, 2.55, 1.85],
            font_size=9.2,
            alignments=[WD_ALIGN_PARAGRAPH.CENTER] * 4,
        )
        add_table(
            doc,
            ["编制日期", "提交日期", "文档状态", "适用范围"],
            [["2026 年 9 月 17 日", "2026 年 9 月 6 日", "需求基线 / 待教师审阅", "课程项目开发、测试和演示"]],
            [1.65, 1.65, 1.75, 1.85],
            font_size=8.9,
            alignments=[WD_ALIGN_PARAGRAPH.CENTER] * 4,
        )

        add_heading(doc, "小组成员", 1)
        add_table(
            doc,
            ["序号", "姓名", "学号", "负责方向"],
            [
                ["1", "岳浩睿", "2024141460114", "需求整理、项目文档与汇报"],
                ["2", "刘铠搏", "2024141460460", "MCP 接入、模型后端与安全确认"],
                ["3", "李洋", "2024141460108", "Web 前端交互与页面实现"],
                ["4", "文一凡", "2024141460396", "Mock 数据、测试与集成部署"],
            ],
            [0.65, 1.7, 1.85, 2.7],
            font_size=9.0,
            alignments=[WD_ALIGN_PARAGRAPH.CENTER] * 4,
        )

        add_heading(doc, "修订记录", 1)
        add_table(
            doc,
            ["版本", "日期", "修订内容", "修订人"],
            [
                ["1.0", "2026-09-06", "形成项目选题、成员信息和简要用户需求列表。", "AI 麦乐送助手小组"],
                ["2.0", "2026-09-17", "参考往届 SRS 结构扩展为正式需求分析说明书；统一 12 条用户需求、14 项系统需求，补充接口、数据、质量、追踪矩阵及图示。", "AI 麦乐送助手小组"],
            ],
            [0.75, 1.15, 4.2, 1.0],
            font_size=8.75,
            alignments=[WD_ALIGN_PARAGRAPH.CENTER, WD_ALIGN_PARAGRAPH.CENTER, WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.CENTER],
        )

        add_heading(doc, "目录", 1)
        add_paragraph(doc, "本目录反映本文档的章节结构；页码以 Word 最终排版为准。", size=10.2, color=MUTED)
        add_table(
            doc,
            ["章节", "主要内容"],
            [
                ["1 引言", "编写目的、项目背景、术语和参考资料"],
                ["2 任务概述", "系统目标、范围、架构和运行环境"],
                ["3 功能需求", "功能划分、需求分配、详细用例和活动图"],
                ["4 数据描述", "数据词典、数据存储、HTTP API、SSE 和外部接口"],
                ["5 性能需求", "精确度、时间特性和适应性"],
                ["6 产品质量需求", "故障分析、可靠性和测试证据"],
                ["7 其他需求", "安全、隐私、易用性、移植性和维护边界"],
                ["8 需求追踪矩阵", "用户需求、系统需求、验收标准和证据"],
            ],
            [1.55, 5.35],
            font_size=9.4,
        )

        # 1 引言
        add_heading(doc, "1 引言", 1)
        add_heading3(doc, "1.1 编写目的")
        add_paragraph(doc, "本文档是 AI 麦乐送助手课程项目的系统需求分析说明书，用于冻结用户需求、功能边界、接口契约、数据结构、质量要求和验收证据。文档同时作为四人小组并行开发、教师审阅、课堂演示和最终报告整理的共同基线。", size=10.5)
        add_paragraph(doc, "本文档采用往届需求分析文档的章节组织和逐项用例表达方式，但所有需求内容均以本项目当前源码、架构说明、测试计划和演示边界为准。", size=10.5)

        add_heading3(doc, "1.2 项目背景")
        add_paragraph(doc, "用户通常只需要用一句自然语言表达“想吃什么、送到哪里、预算多少”，不希望记忆后台工具名称或手工拼接多个查询步骤。本项目把这类自然语言需求转换为地址、门店、菜单、购物车、核价、人工确认、待支付订单和状态查询组成的可解释流程。", size=10.5)
        add_paragraph(doc, "首版以课程演示和可审查的接口边界为目标：Mock Provider 保证无外部凭据时可以复现完整闭环；官方麦当劳中国 MCP 作为可插拔适配器；真实 create-order 仅在测试账号、地址、服务条款和双人复核条件具备时执行一次。", size=10.5)

        add_heading3(doc, "1.3 术语和缩略语")
        add_table(
            doc,
            ["术语", "含义"],
            [
                ["SRS", "系统需求规格说明书（System Requirements Specification）。"],
                ["MCD-USR", "本项目用户需求编号，正式基线为 MCD-USR-0001～0012。"],
                ["MCD-SRS", "本项目系统需求编号，用于将用户需求拆解为可实现、可测试条目。"],
                ["MCP", "Model Context Protocol；本项目通过 Streamable HTTP 访问外部点餐工具。"],
                ["Provider", "FoodOrderProvider 的实现，负责把统一业务接口映射到 Mock 或官方 MCP。"],
                ["ModelAdapter", "在线模型适配层；模型只能使用服务端提供的查询、购物车和核价工具。"],
                ["Mock", "本地可重复的演示数据和规则式 Agent，不代表真实订单或官方服务结果。"],
                ["SSE", "Server-Sent Events；/api/chat 通过流式事件返回工具进度和结构化结果。"],
                ["PriceQuote", "服务端核价结果，包含金额、上下文、有效期和 quoteHash。"],
                ["ApprovalRecord", "服务端保存的一次性报价确认记录，控制 create-order 写操作。"],
            ],
            [1.55, 5.35],
            font_size=8.9,
        )

        add_heading3(doc, "1.4 参考资料")
        add_bullets(doc, [
            "教师提供的往届需求分析文档：参考其正式封面、修订记录、章节层级、需求分配表、用例字段和活动图表达方式。",
            "项目文档 docs/requirements.md：用户需求、用户故事和 AC-001～AC-012 的唯一编号基准。",
            "项目文档 docs/architecture.md：分层架构、HTTP API、SSE 事件、Provider、模型工具和 MCP 适配边界。",
            "项目文档 docs/test-plan.md、docs/demo-script.md、docs/deployment.md：测试、演示、部署和真实联调门槛。",
            "项目源码 apps/server/src/types.ts、http.ts、orchestrator.ts、store.ts、mcp/client.ts 及 providers 目录：接口字段和实际行为来源。",
        ])

        # 2 任务概述
        add_heading(doc, "2 任务概述", 1)
        add_heading3(doc, "2.1 系统目标")
        add_bullets(doc, [
            "把自然语言点餐需求转换为可解释的地址、门店、菜单、购物车、核价和订单状态流程。",
            "通过 FoodOrderProvider 统一封装官方 MCP 与 Mock 数据，降低前端和编排器对外部服务的耦合。",
            "通过服务端报价快照、报价哈希、一次性批准记录和人工确认按钮控制外部写操作。",
            "提供显式标注的 Mock 演示模式，使课堂演示不依赖真实 Token、账号或网络。",
        ])

        add_heading3(doc, "2.2 系统范围")
        add_table(
            doc,
            ["范围内", "范围外"],
            [
                ["自然语言点餐、地址和门店查询、菜单/详情/优惠展示、购物车、核价、人工确认、待支付订单和状态查询。", "完整支付系统、银行卡或支付密码、退款、发票、真实配送履约、商家后台和多平台聚合。"],
                ["React Web 前端、Node HTTP API、ModelAdapter、Mock Provider、官方 MCP Provider、SSE 事件和脱敏本地状态。", "浏览器直接访问 MCP、依赖实验性 WebMCP、把 Mock 结果包装为真实订单。"],
            ],
            [3.45, 3.45],
            font_size=8.85,
        )

        add_heading3(doc, "2.3 系统架构")
        add_paragraph(doc, "浏览器只连接本项目的 HTTP API；服务端编排器负责会话、工具权限、上下文、购物车、核价和订单确认。模型和外部 MCP 均位于服务端，凭据不会进入浏览器。", size=10.5)
        add_picture(doc, diagram_paths["system-overview.png"], "图 2-1 系统总体功能 / 用例图")
        add_table(
            doc,
            ["层次", "主要职责", "当前实现"],
            [
                ["Web 前端", "聊天、工具进度、菜单、购物车、报价确认和订单状态展示。", "React + TypeScript + Vite；消费 REST 与 SSE。"],
                ["HTTP API 与编排器", "校验请求、保存会话、编排工具、执行确认闸门。", "Node HTTP Server + OrderingOrchestrator。"],
                ["模型适配层", "调用 OpenAI 兼容模型并传递工具定义。", "ModelAdapter；无模型配置时使用规则式 Mock Agent。"],
                ["业务 Provider", "统一地址、门店、菜单、优惠、核价、下单和状态接口。", "McDonaldsMcpProvider + MockFoodOrderProvider。"],
                ["持久化与审计", "保存会话、批准记录、订单号和脱敏审计摘要。", "JsonStore；生产环境需替换为安全存储。"],
            ],
            [1.25, 3.15, 2.5],
            font_size=8.65,
        )

        add_heading3(doc, "2.4 运行环境")
        add_table(
            doc,
            ["环境项", "要求或当前配置"],
            [
                ["操作系统", "课程开发机或可运行 Node.js 的本地环境；当前以 Windows + PowerShell 为主。"],
                ["前端", "现代 Chrome、Edge 或同类浏览器；访问本项目 Web 页面。"],
                ["运行时", "Node.js、pnpm、TypeScript；前端使用 Vite，服务端使用 Node HTTP。"],
                ["默认模式", "APP_MODE=mock；健康检查应显示 mode=mock、provider=mock。"],
                ["真实 MCP", "MCD_MCP_URL、MCD_MCP_TOKEN、MCD_MCP_PROTOCOL_VERSION；Token 只放服务端 .env。"],
                ["在线模型", "MODEL_BASE_URL、MODEL_API_KEY、MODEL_NAME；当前目标模型为 deepseek-v4-flash。"],
                ["本地状态", "DATA_FILE 默认指向 ./data/app-state.json；正式部署需使用受保护的数据目录。"],
            ],
            [1.55, 5.35],
            font_size=8.9,
        )

        # 3 功能需求
        add_heading(doc, "3 功能需求", 1)
        add_heading3(doc, "3.1 功能划分")
        add_table(
            doc,
            ["模块编号", "模块名称", "主要功能"],
            [
                ["F-01", "智能会话与会话状态", "自然语言输入、会话恢复、模型/Mock Agent 和助手回复。"],
                ["F-02", "配送上下文", "配送地址、可配送门店及 OrderContext 保存。"],
                ["F-03", "菜单、优惠券与购物车", "菜单、详情、优惠券、加入/合并/查看/清空购物车。"],
                ["F-04", "核价与订单生命周期", "核价、报价快照、人工确认、待支付订单和状态查询。"],
                ["F-05", "演示、安全与协作保障", "Mock、脱敏、审计、错误处理和需求追踪。"],
            ],
            [1.25, 2.25, 3.4],
            font_size=8.9,
        )

        add_heading3(doc, "3.2 需求分配")
        allocation_rows = [
            ["1", "MCD-SRS-1.1.0", "自然语言点餐会话", "ModelAdapter / Mock Agent + /api/chat", "USR-0001；P0"],
            ["2", "MCD-SRS-1.2.0", "配送地址与门店选择", "Provider + /api/context", "USR-0002；P0"],
            ["3", "MCD-SRS-1.3.0", "菜单与餐品详情", "Provider + SSE menu/meal_detail", "USR-0003；P0"],
            ["4", "MCD-SRS-1.4.0", "门店优惠券查询", "Provider + SSE coupons", "USR-0003/0005；P1"],
            ["5", "MCD-SRS-1.5.0", "购物车维护", "服务端购物车 + /api/cart", "USR-0004；P0"],
            ["6", "MCD-SRS-1.6.0", "核价与报价展示", "Provider + PriceQuote + quoteHash", "USR-0005；P0"],
            ["7", "MCD-SRS-1.7.0", "人工确认与订单创建", "/api/orders/confirm + createOrder", "USR-0006；P0"],
            ["8", "MCD-SRS-1.8.0", "待支付链接与订单状态", "PendingOrder + /api/orders/{id}", "USR-0007；P0"],
            ["9", "MCD-SRS-1.9.0", "Mock 演示模式", "MockFoodOrderProvider", "USR-0008；P0"],
            ["10", "MCD-SRS-2.1.0", "密钥、个人信息和支付信息隔离", "服务端 env + safeState/redactText", "USR-0009；P0"],
            ["11", "MCD-SRS-2.2.0", "一次性确认、审计与禁止自动重试", "ApprovalRecord + audit + claimApproval", "USR-0006；安全约束"],
            ["12", "MCD-SRS-3.1.0", "工具调用进度展示", "SSE tool 和结构化事件", "USR-0010；P1"],
            ["13", "MCD-SRS-3.2.0", "友好异常处理", "稳定错误码 + 中文提示", "USR-0011；P1"],
            ["14", "MCD-SRS-4.1.0", "接口契约与团队协作追踪", "Markdown + API/类型/测试映射", "USR-0012；P1"],
        ]
        add_table(
            doc,
            ["序号", "系统需求编号", "功能描述", "实现方式", "备注"],
            allocation_rows,
            [0.45, 1.45, 1.7, 2.45, 0.85],
            font_size=7.55,
            alignments=[WD_ALIGN_PARAGRAPH.CENTER, WD_ALIGN_PARAGRAPH.CENTER, WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.CENTER],
        )

        add_heading3(doc, "3.3 功能描述与用例")
        add_paragraph(doc, "下列用例采用往届文档的“用例描述—参与者—前置/后置条件—输入/输出—事件流—异常—验收—活动图”模板。模型只能自动调用查询、购物车和核价工具；create-order 由人工确认 API 单点触发。", size=10.5)
        add_picture(doc, diagram_paths["module-1.png"], "图 3-1 模块一：智能会话与会话状态")
        add_picture(doc, diagram_paths["module-2.png"], "图 3-2 模块二：配送上下文")
        add_picture(doc, diagram_paths["module-3.png"], "图 3-3 模块三：菜单、优惠券与购物车")
        add_picture(doc, diagram_paths["module-4.png"], "图 3-4 模块四：核价与订单生命周期")
        add_picture(doc, diagram_paths["module-5.png"], "图 3-5 模块五：演示、安全与协作保障")

        module_groups = [
            ("3.3.1 智能会话与会话状态", [USE_CASES[0]]),
            ("3.3.2 配送上下文", [USE_CASES[1]]),
            ("3.3.3 菜单、优惠券与购物车", [USE_CASES[2], USE_CASES[3], USE_CASES[4]]),
            ("3.3.4 核价与订单生命周期", [USE_CASES[5], USE_CASES[6], USE_CASES[7]]),
            ("3.3.5 演示、安全与协作保障", USE_CASES[8:]),
        ]
        for group_title, cases in module_groups:
            add_heading3(doc, group_title)
            for case in cases:
                add_use_case(doc, case, diagram_paths[case["diagram"]])

        add_picture(doc, diagram_paths["confirmation-sequence.png"], "图 3-20 核价—人工确认—订单创建时序图")

        # 4 数据描述
        add_heading(doc, "4 数据描述", 1)
        add_heading3(doc, "4.1 数据词典")
        add_paragraph(doc, "下表列出当前代码中跨模块使用的主要领域对象。浏览器展示字段由 views.ts 白名单控制；地址、订单和日志在持久化或输出前必须脱敏。", size=10.5)
        add_table(
            doc,
            ["对象", "关键字段", "用途", "敏感性/规则"],
            [
                ["Address", "addressId、contactName、phone、fullAddress", "配送地址选择和 OrderContext。", "联系人、手机号、完整地址需脱敏。"],
                ["Store", "storeCode、beCode、storeName、businessStatus", "可配送门店和当前门店。", "由地址查询得到，不接受模型猜测。"],
                ["MenuItem", "productCode、name、price、tags、category", "菜单展示和购物车验证。", "价格来自 Provider；不信任浏览器金额。"],
                ["MealDetail", "code、name、description、choices、supportModify", "餐品详情和可选规格展示。", "只返回浏览器白名单字段。"],
                ["Coupon", "couponId、couponCode、title、validPeriod", "门店优惠券展示和核价输入。", "未知结构 fail closed。"],
                ["CartItem", "productCode、productName、quantity、unitPrice", "服务端购物车和商品小计。", "数量 1～20；同商品合并。"],
                ["OrderContext", "addressId、storeCode、beCode、storeName", "绑定地址和门店，供菜单/核价/下单使用。", "服务端重新校验归属。"],
                ["PriceQuote", "quoteId、items、productPrice、deliveryPrice、discount、totalPrice、expiresAt、quoteHash", "人工确认前的报价快照。", "金额单位明确；确认时复核哈希和有效期。"],
                ["PendingOrder", "orderId、orderStatus、totalAmount、payH5Url", "待支付订单和状态展示。", "支付链接不写入安全状态；不自动支付。"],
                ["ApprovalRecord", "approvalId、sessionId、quote、status、expiresAt", "一次性订单确认闸门。", "pending 后原子领取；禁止自动重试。"],
                ["AuditEvent", "时间、动作、结果、脱敏摘要", "记录查询和写操作审计。", "最多保留 1000 条，禁止凭据和原始个人信息。"],
            ],
            [1.1, 2.35, 2.05, 1.4],
            font_size=7.8,
            alignments=[WD_ALIGN_PARAGRAPH.CENTER, WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.LEFT],
        )

        add_heading3(doc, "4.2 数据库和本地状态")
        add_paragraph(doc, "课程演示使用 DATA_FILE 指向的本地 JSON 文件保存会话、批准记录、订单和审计事件。写入前通过 safeState 处理地址、订单和支付链接；redactText 处理日志中的 Bearer、Token、API Key、Authorization 和手机号。生产环境不能直接把该 JSON 文件作为安全存储。", size=10.5)
        add_table(
            doc,
            ["状态集合", "保存内容", "不保存或处理方式"],
            [
                ["sessions", "会话消息、OrderContext、购物车和必要的结构化结果。", "地址输出脱敏；不保存服务端凭据。"],
                ["approvals", "报价、报价哈希、会话归属、有效期和状态。", "只保留确认所需字段；状态受 claimApproval 控制。"],
                ["orders", "订单号、状态、总金额、门店和脱敏配送地址。", "safeState 移除 payH5Url 等支付信息。"],
                ["audit", "动作、结果、错误分类和脱敏摘要。", "上限 1000 条；不记录 Authorization Header。"],
            ],
            [1.25, 3.5, 2.15],
            font_size=8.55,
        )

        add_heading3(doc, "4.3 HTTP API 契约")
        add_table(
            doc,
            ["接口", "用途", "关键输入/输出", "安全与状态要求"],
            [
                ["GET /api/health", "返回运行健康和配置状态。", "ok、mode、provider、modelConfigured、mcpConfigured、protocolVersion。", "不返回 Token。"],
                ["POST /api/chat", "自然语言会话和工具编排。", "message、sessionId；SSE 事件流。", "工具白名单；错误脱敏。"],
                ["POST /api/context", "保存用户选择的地址和门店。", "sessionId、addressId、storeCode。", "服务端重新查询和校验。"],
                ["POST /api/cart", "加入、合并或清空购物车。", "sessionId、productCode、quantity/clear。", "当前菜单验证；金额不信任浏览器。"],
                ["POST /api/orders/confirm", "核对报价并创建待支付订单。", "sessionId、approvalId、quoteHash；PendingOrder。", "人工确认、哈希、有效期和一次性状态。"],
                ["GET /api/orders/{id}", "读取已保存订单或查询真实状态。", "orderId；订单状态。", "只展示必要且脱敏字段。"],
            ],
            [1.65, 1.7, 2.3, 1.25],
            font_size=7.95,
            alignments=[WD_ALIGN_PARAGRAPH.CENTER, WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.LEFT],
        )

        add_heading3(doc, "4.4 SSE 事件与工具边界")
        add_table(
            doc,
            ["类别", "当前约定"],
            [
                ["SSE 事件", "session、tool、addresses、stores、menu、meal_detail、coupons、cart、quote、confirmation_required、order、assistant、error、done。"],
                ["模型允许工具", "list_delivery_addresses、list_deliverable_stores、list_menu、get_meal_detail、list_store_coupons、add_to_cart、view_cart、calculate_price、get_order_status。"],
                ["模型禁止工具", "create-order 不在模型工具列表中；必须由 /api/orders/confirm 经过人工确认后调用。"],
                ["MCP 必需工具", "delivery-query-addresses、delivery-query-stores、query-meals、query-meal-detail、query-store-coupons、calculate-price、query-order、create-order。"],
                ["MCP 可选能力", "list-nutrition-foods 仅在远端明确提供且餐品精确匹配时使用；不做热量估算。"],
                ["协议与金额", "默认 MCP 协议版本 2025-06-18；超时 30 秒；金额单位由 MCD_MONEY_UNIT 明确配置为 yuan 或 fen，不猜测。"],
            ],
            [1.35, 5.55],
            font_size=8.6,
        )

        # 5 性能需求
        add_heading(doc, "5 性能需求", 1)
        add_heading3(doc, "5.1 数据精确度")
        add_bullets(doc, [
            "金额统一使用 CNY 展示；Provider 返回的 yuan/fen 单位必须由配置明确转换，未知单位直接失败。",
            "商品价、配送费、优惠、总价和有效期均以服务端核价结果为准，浏览器传回的金额不能作为最终可信来源。",
            "确认订单前使用报价内容重新计算 quoteHash，并验证报价未过期、属于当前会话且未被篡改。",
            "购物车数量限制为 1～20；同一 productCode 重复加入时合并数量。",
        ])

        add_heading3(doc, "5.2 时间特性")
        add_table(
            doc,
            ["场景", "要求"],
            [
                ["MCP 请求", "客户端默认超时 30 秒；超时分类为 MCP_TIMEOUT，不自动重试写操作。"],
                ["模型工具编排", "MODEL_MAX_TURNS 默认 8，配置上限为 20；每轮工具结果通过 SSE 尽快展示。"],
                ["报价有效期", "优先使用远端 expiresAt；远端未提供时使用 5 分钟回退有效期；Mock 报价有效期为 5 分钟。"],
                ["页面反馈", "聊天请求使用 SSE 展示工具开始、成功、失败和最终回复，避免长请求期间页面无反馈。"],
            ],
            [1.65, 5.25],
            font_size=8.85,
        )

        add_heading3(doc, "5.3 适应性")
        add_bullets(doc, [
            "MockFoodOrderProvider 与 McDonaldsMcpProvider 实现同一 FoodOrderProvider 接口，允许在不改前端契约的情况下替换外部数据源。",
            "ModelAdapter 使用 OpenAI 兼容接口；模型配置只在服务端环境变量中读取。",
            "APP_MODE、MCD_MCP_PROTOCOL_VERSION、MCD_MONEY_UNIT、DATA_FILE 和模型参数均可通过环境变量配置。",
            "项目面向现代浏览器和本地 Node.js 运行环境；正式生产部署需要替换本地 JSON 存储并补充认证、权限和运维设施。",
        ])

        # 6 产品质量需求
        add_heading(doc, "6 产品质量需求", 1)
        add_heading3(doc, "6.1 故障分析")
        add_table(
            doc,
            ["故障类别", "系统处理", "用户可见结果"],
            [
                ["配置缺失", "默认使用 Mock；health 明确返回当前 mode/provider。", "提示当前为 Mock 演示模式。"],
                ["MCP 401/429", "分类为鉴权或限流错误；真实写操作停止，不静默切换。", "显示友好错误并建议人工处理或切回 Mock。"],
                ["网络错误/超时", "查询错误返回 error；订单写入未知时标记 unknown。", "不自动重试，不把未知状态说成成功。"],
                ["结构异常/金额单位未知", "Provider 严格校验并 fail closed。", "提示外部数据暂不可用。"],
                ["地址/门店/商品无效", "服务端重新查询和验证，拒绝保存或加入。", "提示重新选择有效数据。"],
                ["报价过期/篡改", "确认 API 拒绝请求，要求重新核价。", "不创建订单。"],
                ["重复确认", "ApprovalRecord 非 pending 时拒绝；成功或失败不重复调用。", "显示确认已使用或不可重试。"],
            ],
            [1.55, 3.6, 1.75],
            font_size=8.4,
        )

        add_heading3(doc, "6.2 可靠性")
        add_bullets(doc, [
            "确认记录在第一次 await 前原子地从 pending 领取为 submitting，减少并发重复下单风险。",
            "create-order 只存在一个服务端调用入口；超时、网络错误、限流和未知写入结果不自动重试。",
            "Mock 与真实 Provider 共享接口和事件结构，真实服务不可用时可保留可解释的课堂回退路径。",
            "日志、状态文件和浏览器输出均遵循脱敏规则；审计事件限制数量并保留结果分类。",
        ])

        add_heading3(doc, "6.3 当前验证记录")
        add_table(
            doc,
            ["验证项", "已有记录", "结论边界"],
            [
                ["pnpm test", "26 个测试，26 pass，0 fail。", "本地代码和错误分支已验证；不代表真实 MCP。"],
                ["pnpm test:mock", "HTTP/SSE Mock 端到端 1 个测试，1 pass。", "Mock 闭环已验证；页面录屏仍需课堂保存。"],
                ["pnpm build", "当前项目已有构建通过记录。", "只能说明本地构建；不代表真实服务配置有效。"],
                ["真实 MCP / 在线模型 / 支付", "本次文档更新不执行外部真实请求。", "仍标记为待凭据/阻塞，不能用 Mock 证据替代。"],
            ],
            [1.55, 3.5, 1.85],
            font_size=8.55,
        )

        # 7 其他需求
        add_heading(doc, "7 其他需求", 1)
        add_heading3(doc, "7.1 安全性与隐私")
        add_bullets(doc, [
            "MCD_MCP_TOKEN、MODEL_API_KEY 和 Authorization Header 只存在于服务端运行环境，不进入前端、URL、仓库、日志或截图。",
            "地址、手机号、联系人和订单配送字段在浏览器、状态文件和审计中按最小必要原则展示并脱敏。",
            "应用不保存银行卡、支付密码或支付 Token，不代替用户输入支付信息，不自动完成支付。",
            "真实 create-order 只能使用小组批准的测试账号和配送地址，并由操作成员和复核成员共同确认。",
        ])

        add_heading3(doc, "7.2 易用性")
        add_bullets(doc, [
            "页面使用中文提示和结构化卡片展示地址、门店、菜单、报价、确认和订单状态。",
            "工具运行进度通过 SSE 展示；错误消息说明问题和下一步可操作动作。",
            "Mock、真实 MCP、模拟订单和待支付状态均显式标记，避免用户误解。",
            "创建订单前集中展示地址、门店、商品和金额，确认按钮是明确的人工操作。",
        ])

        add_heading3(doc, "7.3 可维护性")
        add_bullets(doc, [
            "前端只依赖 HTTP/SSE 契约，Provider 私有字段不能直接泄露到浏览器。",
            "需求、架构、测试、演示、分工和最终报告共享 MCD-USR 与 AC 编号。",
            "模型工具白名单、MCP 适配、报价校验、确认闸门和审计逻辑集中在服务端，便于审查和替换。",
            "本文档由 scripts/build_teacher_brief.py 生成，后续需求变更应先修改 Markdown 基线和生成数据，再重新生成并渲染检查。",
        ])

        add_heading3(doc, "7.4 移植性与运行边界")
        add_bullets(doc, [
            "项目可在配置 Node.js、pnpm 和浏览器的本地环境运行；默认 Mock 不依赖外部 MCP。",
            "真实 MCP 依赖远端协议、Token、测试账号、配送地址、网络和服务条款；缺少任一条件时记录为阻塞。",
            "正式生产环境还需要独立的密钥管理、身份认证、权限控制、数据库、监控和订单对账能力，这些不属于本课程首版。",
        ])

        # 8 追踪矩阵
        add_heading(doc, "8 用户需求—系统需求—验收标准追踪矩阵", 1)
        add_paragraph(doc, "本矩阵以 docs/requirements.md 的 12 条用户需求和 AC-001～AC-012 为唯一基准。MCD-USR-0013、MCD-USR-0014 不再新增为用户需求，相关内容分别落在 MCD-SRS-2.1.0 和 MCD-SRS-2.2.0 的系统约束中。", size=10.5)
        trace_rows = [
            ["MCD-USR-0001", "自然语言点餐", "MCD-SRS-1.1.0", "AC-001、AC-002", "聊天记录、助手回复、工具轨迹"],
            ["MCD-USR-0002", "地址和可配送门店", "MCD-SRS-1.2.0", "AC-002、AC-003", "地址/门店卡片、context 响应"],
            ["MCD-USR-0003", "菜单、详情和相关优惠", "MCD-SRS-1.3.0、1.4.0", "AC-003、AC-009", "菜单/详情/优惠券事件"],
            ["MCD-USR-0004", "购物车维护", "MCD-SRS-1.5.0", "AC-003、AC-004", "数量合并、小计和清空结果"],
            ["MCD-USR-0005", "核价和报价展示", "MCD-SRS-1.4.0、1.6.0", "AC-004、AC-009", "报价卡片、金额和有效期"],
            ["MCD-USR-0006", "人工确认后创建订单", "MCD-SRS-1.7.0、2.2.0", "AC-005、AC-006", "确认请求、订单和审计事件"],
            ["MCD-USR-0007", "待支付链接和状态", "MCD-SRS-1.8.0", "AC-007、AC-008", "订单卡片和状态刷新"],
            ["MCD-USR-0008", "无 Token 的 Mock 演示", "MCD-SRS-1.9.0", "AC-001、AC-008", "health、Mock 页面和模拟订单"],
            ["MCD-USR-0009", "凭据和支付信息隔离", "MCD-SRS-2.1.0", "AC-010", "Network、源码、日志和状态文件扫描"],
            ["MCD-USR-0010", "工具运行过程可理解", "MCD-SRS-3.1.0", "AC-002、AC-009", "SSE tool 事件和页面录屏"],
            ["MCD-USR-0011", "友好异常提示", "MCD-SRS-3.2.0", "AC-011", "稳定错误码、中文提示和错误测试"],
            ["MCD-USR-0012", "小组按接口契约并行开发", "MCD-SRS-4.1.0", "AC-012", "文档、分工、测试和审查清单"],
        ]
        add_table(
            doc,
            ["用户需求", "需求摘要", "系统需求", "验收标准", "主要证据"],
            trace_rows,
            [1.2, 1.65, 1.65, 1.05, 1.35],
            font_size=7.65,
            alignments=[WD_ALIGN_PARAGRAPH.CENTER, WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.CENTER, WD_ALIGN_PARAGRAPH.CENTER, WD_ALIGN_PARAGRAPH.LEFT],
        )

        add_heading3(doc, "8.1 验收标准摘要")
        acceptance_rows = [
            ["AC-001", "Mock 启动与健康检查", "返回 ok=true、mode=mock；页面显示 Mock。"],
            ["AC-002", "自然语言查询闭环", "地址、门店、菜单、回复和工具轨迹出现。"],
            ["AC-003", "上下文、菜单和购物车", "选择门店、查看餐品、合并数量、清空购物车。"],
            ["AC-004", "核价", "展示商品价、配送费、优惠、总价和 expiresAt。"],
            ["AC-005", "未确认不下单", "刷新或继续查询不调用 create-order。"],
            ["AC-006", "确认创建一次订单", "校验会话、哈希和有效期后只创建一次。"],
            ["AC-007", "待支付展示", "显示订单号和链接，不自动支付。"],
            ["AC-008", "状态查询", "刷新状态不产生重复订单。"],
            ["AC-009", "真实 MCP 查询门槛", "有凭据时验证地址、门店、菜单、优惠券和核价。"],
            ["AC-010", "敏感信息检查", "浏览器、日志、状态和仓库无敏感值。"],
            ["AC-011", "异常处理", "覆盖配置、401、429、超时、无效数据、过期和重复确认。"],
            ["AC-012", "交付追踪", "需求、接口、测试、分工和证据位置一致。"],
        ]
        add_table(
            doc,
            ["编号", "验收主题", "通过判据"],
            acceptance_rows,
            [0.8, 1.9, 4.2],
            font_size=8.45,
            alignments=[WD_ALIGN_PARAGRAPH.CENTER, WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.LEFT],
        )

        add_heading3(doc, "8.2 真实 MCP 联调门槛")
        add_paragraph(doc, "真实联调不以“读取到 Token”作为完成标准。只有在测试账号、配送地址、服务条款、网络、在线模型和双人复核均具备时，才可以从只读查询开始，最终由操作成员在页面点击一次确认并获得真实待支付订单。", size=10.5)
        add_numbered(doc, [
            "在仓库外确认测试账号、配送地址、支付/服务条款和操作人。",
            "Token 和模型 Key 只写入本地服务端 .env，不写入命令历史、截图、Issue 或提交。",
            "确认 /api/health 返回 mode=mcd，并完成地址、门店、菜单、优惠券和核价查询。",
            "由操作成员和复核成员共同核对地址、商品、金额和报价有效期。",
            "页面明确点击一次确认，获得真实待支付订单号；不自动支付。",
            "记录脱敏证据；若条件不全，保留“阻塞/待凭据”，不能用 Mock 结果替代。",
        ])

        add_heading(doc, "附录 A 文档交付与维护说明", 1)
        add_paragraph(doc, "本文件由 scripts/build_teacher_brief.py 生成。更新需求时，应先修改 docs/requirements.md 及相关接口、测试和演示文档，再运行生成脚本，并按文档技能要求执行 DOCX 结构检查和逐页渲染检查。", size=10.5)
        add_label_paragraph(doc, "生成入口", "scripts/build_teacher_brief.py")
        add_label_paragraph(doc, "主要 Markdown 基线", "docs/requirements.md、docs/architecture.md、docs/test-plan.md、docs/demo-script.md")
        add_label_paragraph(doc, "最终状态", "Mock 路径用于课程稳定演示；真实 MCP、在线模型和支付请求在本次文档更新中不执行。")
        final_note = doc.add_paragraph()
        final_note.paragraph_format.space_before = Pt(12)
        final_note.paragraph_format.space_after = Pt(0)
        add_text(final_note, "本需求分析说明书提交教师审阅，并作为后续详细设计、编码、测试和课堂演示的需求基线。", size=10.5, bold=True, color=GREEN)

        doc.save(OUTPUT)
        print(OUTPUT)
    finally:
        shutil.rmtree(asset_dir, ignore_errors=True)


if __name__ == "__main__":
    build_document()
