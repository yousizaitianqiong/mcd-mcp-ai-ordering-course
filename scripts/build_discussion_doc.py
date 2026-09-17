from pathlib import Path

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK, WD_LINE_SPACING
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.opc.constants import RELATIONSHIP_TYPE as RT
from docx.shared import Inches, Pt, RGBColor


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "AI麦乐送助手_项目方案讨论稿.docx"

BLACK = "000000"
INK = "24211F"
MUTED = "6F6862"
BLUE = "1F4E79"
PALE_BLUE = "EAF2F8"
PALE_GRAY = "F7F8F9"
LINE = "D9D9D9"
GREEN = "176B55"
RED = "A51E32"


def set_run_font(run, name="Microsoft YaHei", size=None, bold=None, color=None, italic=None):
    run.font.name = name
    run._element.get_or_add_rPr().rFonts.set(qn("w:ascii"), name)
    run._element.get_or_add_rPr().rFonts.set(qn("w:hAnsi"), name)
    run._element.get_or_add_rPr().rFonts.set(qn("w:eastAsia"), name)
    run._element.get_or_add_rPr().rFonts.set(qn("w:cs"), name)
    if size is not None:
        run.font.size = Pt(size)
    if bold is not None:
        run.bold = bold
    if italic is not None:
        run.italic = italic
    if color:
        run.font.color.rgb = RGBColor.from_string(color)


def set_style_font(style, name="Microsoft YaHei", size=None, bold=None, color=BLACK):
    style.font.name = name
    style._element.get_or_add_rPr().rFonts.set(qn("w:ascii"), name)
    style._element.get_or_add_rPr().rFonts.set(qn("w:hAnsi"), name)
    style._element.get_or_add_rPr().rFonts.set(qn("w:eastAsia"), name)
    style._element.get_or_add_rPr().rFonts.set(qn("w:cs"), name)
    if size is not None:
        style.font.size = Pt(size)
    if bold is not None:
        style.font.bold = bold
    if color:
        style.font.color.rgb = RGBColor.from_string(color)


def set_cell_shading(cell, fill):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        tc_pr.append(shd)
    shd.set(qn("w:fill"), fill)
    shd.set(qn("w:val"), "clear")


def set_cell_margins(cell, top=100, start=120, bottom=100, end=120):
    tc = cell._tc
    tc_pr = tc.get_or_add_tcPr()
    tc_mar = tc_pr.first_child_found_in("w:tcMar")
    if tc_mar is None:
        tc_mar = OxmlElement("w:tcMar")
        tc_pr.append(tc_mar)
    for margin, value in (("top", top), ("start", start), ("bottom", bottom), ("end", end)):
        node = tc_mar.find(qn(f"w:{margin}"))
        if node is None:
            node = OxmlElement(f"w:{margin}")
            tc_mar.append(node)
        node.set(qn("w:w"), str(value))
        node.set(qn("w:type"), "dxa")


def set_cell_borders(cell, color=LINE, size="6"):
    tc_pr = cell._tc.get_or_add_tcPr()
    borders = tc_pr.first_child_found_in("w:tcBorders")
    if borders is None:
        borders = OxmlElement("w:tcBorders")
        tc_pr.append(borders)
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        tag = f"w:{edge}"
        element = borders.find(qn(tag))
        if element is None:
            element = OxmlElement(tag)
            borders.append(element)
        element.set(qn("w:val"), "single")
        element.set(qn("w:sz"), size)
        element.set(qn("w:space"), "0")
        element.set(qn("w:color"), color)


def set_repeat_table_header(row):
    tr_pr = row._tr.get_or_add_trPr()
    tbl_header = OxmlElement("w:tblHeader")
    tbl_header.set(qn("w:val"), "true")
    tr_pr.append(tbl_header)


def set_no_split(row):
    tr_pr = row._tr.get_or_add_trPr()
    cant_split = OxmlElement("w:cantSplit")
    tr_pr.append(cant_split)


def set_cell_width(cell, width):
    cell.width = Inches(width)
    tc_pr = cell._tc.get_or_add_tcPr()
    tc_w = tc_pr.first_child_found_in("w:tcW")
    if tc_w is None:
        tc_w = OxmlElement("w:tcW")
        tc_pr.append(tc_w)
    tc_w.set(qn("w:w"), str(int(width * 1440)))
    tc_w.set(qn("w:type"), "dxa")


def clear_paragraph(paragraph):
    for child in list(paragraph._p):
        if child.tag != qn("w:pPr"):
            paragraph._p.remove(child)


def add_text(paragraph, text, size=10.5, bold=False, color=INK, italic=False, font="Microsoft YaHei"):
    run = paragraph.add_run(str(text))
    set_run_font(run, font, size, bold, color, italic)
    return run


def add_hyperlink(paragraph, text, url, size=9, color=BLUE):
    part = paragraph.part
    r_id = part.relate_to(url, RT.HYPERLINK, is_external=True)
    hyperlink = OxmlElement("w:hyperlink")
    hyperlink.set(qn("r:id"), r_id)
    new_run = OxmlElement("w:r")
    r_pr = OxmlElement("w:rPr")
    r_fonts = OxmlElement("w:rFonts")
    for attr in ("ascii", "hAnsi", "eastAsia", "cs"):
        r_fonts.set(qn(f"w:{attr}"), "Microsoft YaHei")
    r_pr.append(r_fonts)
    sz = OxmlElement("w:sz")
    sz.set(qn("w:val"), str(int(size * 2)))
    r_pr.append(sz)
    color_el = OxmlElement("w:color")
    color_el.set(qn("w:val"), color)
    r_pr.append(color_el)
    underline = OxmlElement("w:u")
    underline.set(qn("w:val"), "single")
    r_pr.append(underline)
    new_run.append(r_pr)
    text_node = OxmlElement("w:t")
    text_node.text = text
    new_run.append(text_node)
    hyperlink.append(new_run)
    paragraph._p.append(hyperlink)


def add_paragraph(doc, text="", style=None, size=10.5, bold=False, color=INK, before=0, after=6, line=1.25, align=None):
    paragraph = doc.add_paragraph(style=style)
    paragraph.paragraph_format.space_before = Pt(before)
    paragraph.paragraph_format.space_after = Pt(after)
    paragraph.paragraph_format.line_spacing = line
    if align is not None:
        paragraph.alignment = align
    if text:
        add_text(paragraph, text, size=size, bold=bold, color=color)
    return paragraph


def add_bullet(doc, text, level=0, color=INK):
    paragraph = doc.add_paragraph(style="List Bullet")
    paragraph.paragraph_format.left_indent = Inches(0.25 + level * 0.2)
    paragraph.paragraph_format.first_line_indent = Inches(-0.14)
    paragraph.paragraph_format.space_after = Pt(3)
    paragraph.paragraph_format.line_spacing = 1.18
    add_text(paragraph, text, size=10.2, color=color)
    return paragraph


def add_number(doc, number, text):
    paragraph = doc.add_paragraph()
    paragraph.paragraph_format.left_indent = Inches(0.26)
    paragraph.paragraph_format.first_line_indent = Inches(-0.26)
    paragraph.paragraph_format.space_after = Pt(4)
    paragraph.paragraph_format.line_spacing = 1.2
    add_text(paragraph, f"{number}. ", size=10.4, bold=True, color=BLUE)
    add_text(paragraph, text, size=10.4)
    return paragraph


def add_heading(doc, text, level=1):
    style = "Heading 1" if level == 1 else "Heading 2"
    paragraph = doc.add_paragraph(style=style)
    paragraph.paragraph_format.keep_with_next = True
    paragraph.paragraph_format.space_before = Pt(15 if level == 1 else 9)
    paragraph.paragraph_format.space_after = Pt(6 if level == 1 else 4)
    add_text(paragraph, text, size=15 if level == 1 else 11.5, bold=True, color=BLACK)
    return paragraph


def add_table(doc, headers, rows, widths, font_size=8.7, header_fill=BLUE, alignments=None):
    table = doc.add_table(rows=1, cols=len(headers))
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    header = table.rows[0]
    set_repeat_table_header(header)
    for index, (cell, heading, width) in enumerate(zip(header.cells, headers, widths)):
        set_cell_width(cell, width)
        set_cell_shading(cell, header_fill)
        set_cell_borders(cell)
        set_cell_margins(cell, top=125, start=125, bottom=125, end=125)
        cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
        paragraph = cell.paragraphs[0]
        paragraph.alignment = alignments[index] if alignments else WD_ALIGN_PARAGRAPH.LEFT
        paragraph.paragraph_format.space_after = Pt(0)
        clear_paragraph(paragraph)
        add_text(paragraph, heading, size=font_size, bold=True, color="FFFFFF")

    for row_index, values in enumerate(rows):
        row = table.add_row()
        set_no_split(row)
        for index, (cell, value, width) in enumerate(zip(row.cells, values, widths)):
            set_cell_width(cell, width)
            set_cell_shading(cell, PALE_BLUE if row_index % 2 == 1 else "FFFFFF")
            set_cell_borders(cell)
            set_cell_margins(cell, top=105, start=125, bottom=105, end=125)
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
            paragraph = cell.paragraphs[0]
            paragraph.paragraph_format.space_after = Pt(0)
            paragraph.paragraph_format.line_spacing = 1.12
            paragraph.alignment = alignments[index] if alignments else WD_ALIGN_PARAGRAPH.LEFT
            clear_paragraph(paragraph)
            add_text(paragraph, value, size=font_size, color=INK)
    doc.add_paragraph().paragraph_format.space_after = Pt(1)
    return table


def add_label_paragraph(doc, label, text):
    paragraph = doc.add_paragraph()
    paragraph.paragraph_format.space_after = Pt(6)
    paragraph.paragraph_format.line_spacing = 1.22
    add_text(paragraph, f"{label}：", size=10.5, bold=True, color=BLUE)
    add_text(paragraph, text, size=10.5)
    return paragraph


def add_code_line(doc, text):
    paragraph = doc.add_paragraph()
    paragraph.paragraph_format.left_indent = Inches(0.18)
    paragraph.paragraph_format.space_after = Pt(2)
    paragraph.paragraph_format.line_spacing = 1.08
    run = add_text(paragraph, text, size=9, color=INK, font="Consolas")
    run._element.get_or_add_rPr().append(OxmlElement("w:noProof"))
    return paragraph


def add_link_line(doc, label, url):
    paragraph = doc.add_paragraph()
    paragraph.paragraph_format.left_indent = Inches(0.18)
    paragraph.paragraph_format.space_after = Pt(3)
    add_text(paragraph, f"{label}  ", size=9.3, color=INK)
    add_hyperlink(paragraph, url, url, size=9.3)
    return paragraph


def setup_document(doc):
    section = doc.sections[0]
    section.page_width = Inches(8.5)
    section.page_height = Inches(11)
    section.top_margin = Inches(0.68)
    section.bottom_margin = Inches(0.65)
    section.left_margin = Inches(0.72)
    section.right_margin = Inches(0.72)
    section.header_distance = Inches(0.3)
    section.footer_distance = Inches(0.3)

    styles = doc.styles
    set_style_font(styles["Normal"], size=10.5, color=INK)
    styles["Normal"].paragraph_format.space_after = Pt(6)
    styles["Normal"].paragraph_format.line_spacing = 1.25
    set_style_font(styles["Title"], size=24, bold=True, color=BLACK)
    title_ppr = styles["Title"]._element.get_or_add_pPr()
    title_border = title_ppr.find(qn("w:pBdr"))
    if title_border is not None:
        title_ppr.remove(title_border)
    set_style_font(styles["Heading 1"], size=15, bold=True, color=BLACK)
    set_style_font(styles["Heading 2"], size=11.5, bold=True, color=BLACK)
    for name in ("List Bullet", "List Number"):
        if name in styles:
            set_style_font(styles[name], size=10.2, color=INK)

    header = section.header.paragraphs[0]
    header.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    header.paragraph_format.space_after = Pt(0)
    add_text(header, "AI 麦乐送助手 方案讨论稿", size=8.5, color=MUTED)
    footer = section.footer.paragraphs[0]
    footer.alignment = WD_ALIGN_PARAGRAPH.CENTER
    footer.paragraph_format.space_before = Pt(0)
    add_text(footer, "问题求解实战课程小组项目  |  版本 0.1  |  2026 年 9 月", size=8.2, color=MUTED)


def build_document():
    doc = Document()
    setup_document(doc)
    doc.core_properties.title = "AI 麦乐送助手项目方案讨论稿"
    doc.core_properties.subject = "问题求解实战课程小组项目选题与实施方案"
    doc.core_properties.author = "AI 麦乐送助手小组"
    doc.core_properties.comments = "用于小组内部讨论确认，不是最终项目报告。"

    title = doc.add_paragraph(style="Title")
    title.alignment = WD_ALIGN_PARAGRAPH.LEFT
    title.paragraph_format.space_before = Pt(22)
    title.paragraph_format.space_after = Pt(7)
    add_text(title, "AI 麦乐送助手项目方案讨论稿", size=24, bold=True, color=BLACK)

    subtitle = doc.add_paragraph()
    subtitle.paragraph_format.space_after = Pt(17)
    add_text(subtitle, "问题求解实战课程小组项目", size=12, color=MUTED)

    meta = add_table(
        doc,
        ["讨论版本", "小组规模", "建议周期", "当前状态"],
        [["v0.1", "4 人", "2–4 周", "待小组确认"]],
        [1.55, 1.55, 1.55, 2.25],
        font_size=9.2,
        header_fill=BLUE,
        alignments=[WD_ALIGN_PARAGRAPH.CENTER] * 4,
    )
    for cell in meta.rows[1].cells:
        cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER

    add_heading(doc, "本稿用途", 1)
    add_paragraph(
        doc,
        "本稿用于向小组成员展示“AI 麦乐送助手”的选题、功能边界和落地方式，先确认项目方向，再进入正式编码和任务拆分。建议的结论是：以 Mock 数据完成一条可重复演示的点餐闭环，以官方麦当劳中国 MCP 作为可插拔适配器；首版不把真实支付、商家后台和多平台聚合纳入范围。",
        size=10.8,
        after=7,
    )
    add_label_paragraph(doc, "开会前重点确认", "项目是否采用该选题；四人是否接受角色分工；是否允许使用在线模型和官方 MCP 做小范围查询联调；真实 create-order 是否只做代码路径展示而不触发外部订单。")

    add_heading(doc, "一页总览", 1)
    add_table(
        doc,
        ["项目要素", "本方案建议"],
        [
            ["项目名称", "AI 麦乐送助手"],
            ["解决的问题", "把自然语言点餐转换为地址、门店、菜单、核价和订单状态的可解释流程。"],
            ["用户交互", "聊天窗口、地址/门店选择、菜单卡片、购物车、报价确认、待支付链接和订单状态。"],
            ["技术路线", "React + TypeScript + Vite；Node.js + TypeScript；Provider 与 ModelAdapter 接口解耦。"],
            ["演示策略", "默认 Mock 模式可离线完成闭环；配置服务端 Token 后切换官方 MCP 模式。"],
            ["关键安全点", "Token 只留在后端；模型不能自动创建订单；写操作不自动重试；支付由用户自行完成。"],
        ],
        [1.45, 5.45],
        font_size=9.3,
    )

    add_heading(doc, "项目定位", 1)
    add_heading(doc, "使用场景", 2)
    add_paragraph(doc, "用户在网页中用自然语言表达“想吃什么、送到哪里、预算多少”，助手先查询可用地址和门店，再展示菜单和优惠，用户把餐品加入购物车后请求核价。助手只把查询和核价交给模型自动处理，创建待支付订单前必须由用户检查并点击确认。", size=10.5)
    add_heading(doc, "参考文件的使用边界", 2)
    add_paragraph(doc, "教师提供的“简要用户需求列表_XXX小组.doc”主要用于参考编号化需求的表达格式。其内容是聊天工具的注册、好友、聊天记录和管理员查询示例，不构成 AI 点餐项目的功能约束。本项目将需求重新编号为 MCD-USR-0001 等，并围绕点餐闭环验收。", size=10.5)
    add_paragraph(doc, "参考文件位置：C:/Users/Hhhfg/Downloads/简要用户需求列表_XXX小组.doc", size=9.3, color=MUTED)
    add_heading(doc, "首版范围", 2)
    add_table(
        doc,
        ["首版包含", "首版暂不包含"],
        [
            ["自然语言点餐、地址和门店查询、菜单和优惠展示、购物车、核价、人工确认、待支付链接、订单状态、Mock 回退。", "完整支付系统、银行卡信息、退款发票、商家运营后台、配送履约和多平台外卖聚合。"],
            ["官方 MCP Provider、Mock Provider、OpenAI 兼容模型适配器、SSE 工具进度、脱敏审计日志。", "把 Token 放到浏览器、依赖实验性 Chrome WebMCP、把 Mock 结果伪装成真实下单。"],
        ],
        [3.45, 3.45],
        font_size=9.1,
    )

    add_heading(doc, "核心业务流程", 1)
    flow = doc.add_paragraph()
    flow.alignment = WD_ALIGN_PARAGRAPH.CENTER
    flow.paragraph_format.space_before = Pt(3)
    flow.paragraph_format.space_after = Pt(13)
    add_text(flow, "自然语言点餐  →  地址  →  门店  →  菜单  →  购物车  →  核价  →  人工确认  →  待支付订单  →  状态查询", size=11.2, bold=True, color=BLUE)
    for index, (title_text, body) in enumerate([
        ("表达需求", "用户输入餐品、数量、预算或优惠需求。"),
        ("确定配送上下文", "查询用户地址和可配送门店，用户可切换门店。"),
        ("选择餐品", "查询真实菜单，展示餐品卡片，加入购物车。"),
        ("核价", "服务端重新计算商品价、配送费、优惠、总价和有效期。"),
        ("确认订单", "用户确认报价后，服务端才允许调用 create-order。"),
        ("查看状态", "展示订单号、待支付链接和 query-order 返回的状态。"),
    ], 1):
        add_number(doc, index, f"{title_text}：{body}")

    add_heading(doc, "编号化用户需求", 1)
    add_paragraph(doc, "以下编号作为小组开发和验收的共同语言。P0 是首版必须完成的功能，P1 是有余力时补充的体验和异常能力。", size=10.5)
    add_table(
        doc,
        ["编号", "用户需求", "验收条件", "优先级"],
        [
            ["MCD-USR-0001", "用户可以用自然语言描述餐品、数量、预算或优惠需求。", "聊天区接受中文文本并返回助手回复；无模型时 Mock 规则代理仍能演示。", "P0"],
            ["MCD-USR-0002", "用户可以查看配送地址并选择可配送门店。", "页面显示地址和门店，选择后更新当前上下文。", "P0"],
            ["MCD-USR-0003", "用户可以查看当前门店菜单和餐品详情。", "显示餐品名称、价格、标签，并可加入购物车。", "P0"],
            ["MCD-USR-0004", "用户可以维护购物车。", "支持加入餐品、数量合并、查看小计和清空。", "P0"],
            ["MCD-USR-0005", "用户可以发起核价。", "返回商品价、配送费、优惠、总价和有效期。", "P0"],
            ["MCD-USR-0006", "创建订单必须人工确认。", "模型工具列表没有 create-order，只有确认按钮请求创建。", "P0"],
            ["MCD-USR-0007", "用户可以获得待支付链接并查看订单状态。", "显示订单号、状态和支付链接，支付由用户自行完成。", "P0"],
            ["MCD-USR-0008", "无 Token 或网络异常时可以完成课程演示。", "健康检查标注 mock，页面不伪装官方结果。", "P0"],
            ["MCD-USR-0009", "用户不能看到服务端密钥或支付信息。", "浏览器响应、源代码和日志不出现 Token、Key 或 Authorization。", "P0"],
            ["MCD-USR-0010", "用户可以理解工具调用过程。", "页面展示地址、门店、菜单和核价工具的运行状态。", "P1"],
            ["MCD-USR-0011", "用户可以获得友好的异常提示。", "覆盖 401、429、超时、空地址、无门店、失效商品、报价过期和重复确认。", "P1"],
            ["MCD-USR-0012", "四人可以按接口契约并行开发。", "Provider、ModelAdapter、HTTP API 和前端事件结构形成文档。", "P1"],
        ],
        [1.15, 2.05, 3.2, 0.55],
        font_size=8.1,
        alignments=[WD_ALIGN_PARAGRAPH.CENTER, WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.CENTER],
    )

    add_heading(doc, "系统架构", 1)
    add_paragraph(doc, "建议采用四层结构，让前端、模型、MCP 和 Mock 可以分别替换。浏览器只连接本项目的 HTTP API，不直接连接 MCP，也不接触任何服务端密钥。", size=10.5)
    add_table(
        doc,
        ["层次", "主要职责", "课程项目实现"],
        [
            ["Web 前端", "展示聊天、工具进度、菜单、购物车、报价确认和订单状态。", "React + TypeScript + Vite；SSE 消费 /api/chat。"],
            ["HTTP API 与编排器", "保存会话，编排模型工具调用，执行参数校验和确认闸门。", "Node HTTP Server + OrderingOrchestrator。"],
            ["模型适配", "调用 OpenAI 兼容在线模型，传递 JSON Schema 工具定义。", "ModelAdapter；无模型时走规则演示代理。"],
            ["业务 Provider", "把统一业务接口映射到官方 MCP 或 Mock 数据。", "McDonaldsMcpProvider + MockFoodOrderProvider。"],
            ["持久化与审计", "保存会话、报价状态、订单号和脱敏审计摘要。", "课程演示使用本地 JSON 文件；生产环境需换安全存储。"],
        ],
        [1.25, 3.0, 2.7],
        font_size=8.8,
    )
    add_heading(doc, "数据流", 2)
    add_paragraph(doc, "POST /api/chat → OrderingOrchestrator → ModelAdapter 或 Mock Agent → 白名单工具 → FoodOrderProvider → SSE 返回结构化事件。用户点击确认后，POST /api/orders/confirm → 报价校验 → create-order → 保存订单 → 展示待支付链接。", size=10.3)

    add_heading(doc, "冻结接口", 1)
    add_heading(doc, "FoodOrderProvider", 2)
    for line in [
        "listAddresses",
        "listDeliverableStores",
        "listMeals",
        "getMealDetail",
        "listStoreCoupons",
        "calculatePrice",
        "createOrder",
        "getOrderStatus",
    ]:
        add_code_line(doc, f"FoodOrderProvider.{line}(...) ")
    add_heading(doc, "ModelAdapter", 2)
    add_paragraph(doc, "支持流式或非流式文本、JSON Schema 工具定义和 tool calling。当前首版用 OpenAI 兼容 Chat Completions 适配器，模型配置只在后端环境变量中读取。", size=10.3)
    add_heading(doc, "Web API 最小集合", 2)
    add_table(
        doc,
        ["接口", "用途", "关键安全点"],
        [
            ["GET /api/health", "返回 mock 或 mcd 模式、Provider、协议版本。", "不返回 Token。"],
            ["POST /api/chat", "接收自然语言，返回 SSE 文本、工具进度、菜单、报价和确认请求。", "错误脱敏；工具参数不带密钥。"],
            ["POST /api/context", "更新用户选择的地址和门店。", "服务端重新查询并校验地址、门店归属。"],
            ["POST /api/cart", "加入或清空购物车。", "商品必须来自查询结果；金额不作为最终可信来源。"],
            ["POST /api/orders/confirm", "核对报价后创建待支付订单。", "报价未过期、属于当前会话，且只允许人工确认触发。"],
            ["GET /api/orders/{orderId}", "读取已保存订单或查询真实状态。", "只展示必要的订单字段。"],
        ],
        [1.75, 3.25, 1.95],
        font_size=8.8,
    )

    add_heading(doc, "安全与风险控制", 1)
    add_table(
        doc,
        ["风险", "设计措施", "课堂验收"],
        [
            ["Token 泄露", "Token 只读服务端 .env，不进浏览器、URL、数据库和日志。", "检查浏览器 Network、源码和 data/app-state.json。"],
            ["模型误下单", "create-order 不在模型工具白名单，只能由确认 API 调用。", "查看工具列表并验证未点击确认时没有订单。"],
            ["报价被篡改", "服务端保存 approvalId、报价哈希/内容和有效期，确认时复核会话归属。", "修改或过期报价后确认应失败。"],
            ["重复提交", "写操作失败不自动重试；确认记录有 pending、confirmed、expired 状态。", "重复点击返回已使用，不重复调用 Provider。"],
            ["官方服务不可用", "显式切换 Mock 模式，页面和健康检查标注模拟状态。", "断网或无 Token 时仍可完成演示，但不冒充真实订单。"],
            ["支付风险", "只展示待支付链接，不保存或代替用户输入支付信息。", "演示说明由用户自行打开和支付。"],
        ],
        [1.25, 3.7, 2.0],
        font_size=8.7,
    )

    add_heading(doc, "GitHub 调研与融合对象", 1)
    add_paragraph(doc, "借鉴公开项目的架构思路和交互方式，不复制第三方密钥、品牌素材、私有接口或未经许可的实现。提交前需要再次核对每个仓库的当前许可证、非商业限制和商标边界。", size=10.4)
    add_table(
        doc,
        ["项目", "借鉴内容", "本项目使用边界"],
        [
            ["M-China/mcd-mcp-server", "官方 MCP 的地址、认证方式、工具参数和业务顺序。", "只做 Provider 适配；遵守其非商业使用条款，不复制品牌内容或泄露 Token。"],
            ["mcd-mcp-app", "React + TypeScript、工具结果可视化和 MCP UI 资源。", "借鉴 UI，不采用把 Token 放进 URL 查询参数的方式。"],
            ["mcd-mcp-cli", "Streamable HTTP、环境变量、工具白名单和版本兼容。", "作为 MCP 适配层设计参考，凭据留在后端。"],
            ["Azure pizza-mcp-agents", "业务 API、MCP 服务和 Web 订单面板的分层结构。", "借鉴本地可运行和 Mock 数据方案，不引入其云资源依赖。"],
            ["WebMCP Starter", "搜索、菜单、购物车、优惠、结算和订单状态交互链路。", "借鉴用户流程，不依赖实验性的 Chrome WebMCP。"],
            ["Peckish", "人工确认闸门、严格工具参数、审计日志、写操作不自动重试。", "借鉴安全机制，不接入其 DoorDash 私有实现。"],
            ["Canteen Flow", "Mock 点餐、访客模式、订单状态和管理界面。", "作为本地演示回退方案，不实现完整商家后台。"],
        ],
        [1.55, 2.8, 2.6],
        font_size=8.5,
    )
    add_heading(doc, "参考链接", 2)
    for label, url in [
        ("M-China/mcd-mcp-server", "https://github.com/M-China/mcd-mcp-server"),
        ("mcd-mcp-app", "https://github.com/599yongyang/mcd-mcp-app"),
        ("mcd-mcp-cli", "https://github.com/Kingwl/mcd-mcp-cli"),
        ("Azure pizza-mcp-agents", "https://github.com/Azure-Samples/pizza-mcp-agents"),
        ("WebMCP Starter", "https://github.com/Doriandarko/webmcp-starter"),
        ("Peckish", "https://github.com/CydVilla/peckish"),
        ("Canteen Flow", "https://github.com/sushil930/canteen-flow"),
    ]:
        add_link_line(doc, label, url)

    add_heading(doc, "四人分工", 1)
    add_table(
        doc,
        ["成员角色", "负责模块", "主要产出", "联调接口"],
        [
            ["成员 A 需求与文档", "需求编号、用例、架构说明、演示脚本和最终报告。", "需求文档、架构图、调研矩阵、演示记录。", "维护验收口径和变更表。"],
            ["成员 B MCP 与模型后端", "远程 MCP 客户端、官方 Provider、模型适配、工具白名单和安全确认。", "MCP Client、Provider、ModelAdapter、Orchestrator。", "Provider 与 SSE 事件。"],
            ["成员 C 前端交互", "聊天、工具轨迹、菜单/优惠卡片、购物车、核价确认和订单页面。", "React 页面、事件消费、响应式样式。", "消费 SSE 与 REST API。"],
            ["成员 D Mock 测试与集成", "模拟数据、异常测试、端到端测试、部署说明和课堂联调。", "Mock Provider、测试记录、联调清单。", "稳定演示数据和回退方案。"],
        ],
        [1.45, 2.25, 2.15, 1.1],
        font_size=8.5,
    )
    add_heading(doc, "建议排期", 2)
    add_table(
        doc,
        ["阶段", "工作重点", "结束标准"],
        [
            ["第 1 周", "冻结需求和接口；完成 Mock 地址、门店、菜单、购物车、核价。", "无网络可演示最小闭环。"],
            ["第 2 周", "接入模型工具调用；完成前端 SSE、菜单、确认卡片；补齐异常测试。", "Mock 全流程通过，四人可以分支联调。"],
            ["第 3–4 周", "小范围验证官方 MCP；完善报告、测试证据、演示脚本和部署说明。", "能说明真实联调边界，并保留 Mock 回退。"],
        ],
        [1.15, 4.25, 1.55],
        font_size=8.8,
    )

    add_heading(doc, "测试与验收", 1)
    add_heading(doc, "必须覆盖的技术场景", 2)
    add_bullet(doc, "MCP tools/list、Bearer Token、2025-06-18 协议版本兼容，以及工具参数校验和结构化结果解析。")
    add_bullet(doc, "401、429、超时、空地址、无可配送门店、商品失效、报价过期和重复确认。")
    add_bullet(doc, "浏览器无 Token，日志脱敏，写操作不自动重试，创建订单超时不重复提交。")
    add_bullet(doc, "Mock 模式完成自然语言点餐、菜单查询、核价、确认、生成待支付订单和状态查询。")
    add_heading(doc, "课堂验收主流程", 2)
    add_table(
        doc,
        ["步骤", "操作", "观察结果"],
        [
            ["1", "打开首页并查看健康状态。", "显示 Mock 演示模式或官方 MCP 模式，不显示密钥。"],
            ["2", "输入“我想吃麦香鸡套餐，先帮我看看当前菜单和门店”。", "工具轨迹、地址/门店、菜单卡片出现。"],
            ["3", "加入餐品并点击开始核价。", "报价卡片显示商品价、配送费、优惠、总价和有效期。"],
            ["4", "不点击确认，发送查询或刷新页面。", "不能创建订单。"],
            ["5", "核对信息后点击确认并创建待支付订单。", "显示订单号和待支付状态；不会自动支付。"],
            ["6", "点击刷新或输入查询订单状态。", "状态更新，不产生重复订单。"],
        ],
        [0.55, 3.25, 3.15],
        font_size=8.9,
        alignments=[WD_ALIGN_PARAGRAPH.CENTER, WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.LEFT],
    )

    add_heading(doc, "讨论确认事项", 1)
    add_paragraph(doc, "请小组成员在讨论后把结论填入下表。若某项尚未决定，可以保留“待确认”，但正式编码前应至少确定项目范围、四人角色和真实 MCP 的联调边界。", size=10.5)
    add_table(
        doc,
        ["确认项", "建议结论", "小组结论"],
        [
            ["项目选题", "采用 AI 麦乐送助手，首版以 Mock 闭环为主。", "待填写：________________"],
            ["小组人数", "4 人，按需求文档、后端、前端、测试集成分工。", "待填写：________________"],
            ["技术路线", "Node.js + TypeScript；React + TypeScript；接口先冻结。", "待填写：________________"],
            ["在线模型", "使用小组可获得的 OpenAI 兼容 API，Key 只放后端。", "待填写：________________"],
            ["官方 MCP", "先做查询和核价联调；真实 create-order 需单独人工确认。", "待填写：________________"],
            ["演示口径", "Mock 结果明确标注，不把模拟订单说成真实订单。", "待填写：________________"],
            ["项目周期", "预计 2–4 周，第二周完成 Mock 闭环。", "待填写：________________"],
        ],
        [1.35, 3.35, 2.25],
        font_size=8.8,
    )
    add_heading(doc, "会议记录", 2)
    for label in ["讨论日期", "参会成员", "已确认决定", "需要调整的功能", "下一步负责人和截止时间"]:
        add_label_paragraph(doc, label, "____________________________________________________________")

    add_heading(doc, "附录 环境变量与演示命令", 1)
    add_paragraph(doc, "默认配置为 Mock 模式。真实服务配置只写在服务端 .env，不能提交到 Git。", size=10.4)
    for line in [
        "APP_MODE=mock",
        "PORT=8787",
        "MCD_MCP_URL=https://mcp.mcd.cn",
        "MCD_MCP_PROTOCOL_VERSION=2025-06-18",
        "MCD_MCP_TOKEN=",
        "MODEL_BASE_URL=",
        "MODEL_API_KEY=",
        "MODEL_NAME=",
    ]:
        add_code_line(doc, line)
    add_heading(doc, "建议启动命令", 2)
    for line in ["pnpm install", "Copy-Item .env.example .env", "pnpm build", "pnpm dev"]:
        add_code_line(doc, line)
    add_paragraph(doc, "本讨论稿的下一步不是立即扩大功能，而是先由四位成员确认项目方向、外部服务边界和分工；确认后再以编号需求和冻结接口作为实现基线。", size=10.5, bold=True, color=GREEN, before=7, after=0)

    doc.save(OUTPUT)
    print(OUTPUT)


if __name__ == "__main__":
    build_document()
