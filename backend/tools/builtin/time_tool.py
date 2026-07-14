from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo
from typing import Optional
from langchain.tools import tool

# ── Solar terms lookup (approximate dates, accurate to ±1 day) ──
SOLAR_TERMS = [
    ("小寒", 1, (5, 7)), ("大寒", 1, (20, 22)),
    ("立春", 2, (3, 5)), ("雨水", 2, (18, 20)),
    ("惊蛰", 3, (5, 7)), ("春分", 3, (20, 22)),
    ("清明", 4, (4, 6)), ("谷雨", 4, (19, 21)),
    ("立夏", 5, (5, 7)), ("小满", 5, (20, 22)),
    ("芒种", 6, (5, 7)), ("夏至", 6, (21, 23)),
    ("小暑", 7, (6, 8)), ("大暑", 7, (22, 24)),
    ("立秋", 8, (7, 9)), ("处暑", 8, (22, 24)),
    ("白露", 9, (7, 9)), ("秋分", 9, (22, 24)),
    ("寒露", 10, (7, 9)), ("霜降", 10, (23, 24)),
    ("立冬", 11, (7, 8)), ("小雪", 11, (22, 23)),
    ("大雪", 12, (6, 8)), ("冬至", 12, (21, 23)),
]

CN_HOLIDAYS_SOLAR = {
    (1, 1): "元旦",
    (3, 8): "妇女节",
    (4, 5): "清明节",
    (5, 1): "劳动节",
    (6, 1): "儿童节",
    (10, 1): "国庆节",
}

CN_HOLIDAYS_LUNAR = {
    (1, 1): "春节",
    (1, 15): "元宵节",
    (5, 5): "端午节",
    (7, 7): "七夕",
    (8, 15): "中秋节",
    (9, 9): "重阳节",
    (12, 30): "除夕",
}

WEEKDAYS_CN = ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"]

TIANGAN = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"]
DIZHI = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"]
ZODIAC = ["鼠", "牛", "虎", "兔", "龙", "蛇", "马", "羊", "猴", "鸡", "狗", "猪"]


def _get_solar_term(d: date) -> Optional[str]:
    for name, m, (start, end) in SOLAR_TERMS:
        if m == d.month and start <= d.day <= end:
            return name
    return None


def _get_all_solar_terms(year: int) -> dict:
    return {name: f"{year}-{m:02d}-{(start + end) // 2:02d}" for name, m, (start, end) in SOLAR_TERMS}


def _ganzhi_year(year: int) -> str:
    base = 4  # 公元4年为甲子年
    offset = (year - base) % 60
    return f"{TIANGAN[offset % 10]}{DIZHI[offset % 12]}"


def _zodiac_year(year: int) -> str:
    return ZODIAC[(year - 4) % 12]


def _resolve_date(target_date: Optional[str], timezone: str) -> tuple[date, datetime]:
    """Return (ref_date, now_dt). If target_date is None, use current time."""
    now = datetime.now(ZoneInfo(timezone))
    if target_date:
        return date.fromisoformat(target_date), now
    return now.date(), now


@tool
def get_current_time(
    query_type: str = "current",
    target_date: Optional[str] = None,
    timezone: str = "Asia/Shanghai",
    target_timezone: str = "",
) -> str:
    """
    Unified time tool covering all time-related queries: current time, day of week,
    solar terms (24节气), countdown, timezone conversion, lunar calendar (农历),
    and Chinese holidays.

    Use this tool for ANY question about time, date, year, weekday, solar terms,
    countdown, timezone, lunar date, or holidays. Do NOT try to answer time questions
    yourself — always call this tool.

    Args:
        query_type: Type of time query. One of:
            "current" - get current date/time with timezone
            "weekday" - get day of week for a date (e.g. 星期一)
            "solar_term" - get solar term for a date, or list all terms in a year
            "countdown" - days until/since a target_date
            "timezone_convert" - convert time from timezone to target_timezone
            "lunar" - convert Gregorian date to Chinese lunar calendar (农历)
            "holiday" - check if a date is a Chinese holiday
        target_date: Date string like "2026-12-25" (optional, defaults to today)
        timezone: IANA timezone name (default: "Asia/Shanghai")
        target_timezone: Target IANA timezone for timezone_convert queries
    """
    try:
        ref_date, now = _resolve_date(target_date, timezone)

        if query_type == "current":
            fmt = now.strftime("%Y-%m-%d %H:%M:%S")
            tz_name = now.strftime("%Z")
            gs = _ganzhi_year(now.year)
            sx = _zodiac_year(now.year)
            term = _get_solar_term(now.date())
            lines = [
                f"当前时间: {fmt} ({timezone})",
                f"年份: {now.year}年 ({gs}年, 属{sx})",
            ]
            if term:
                lines.append(f"当前节气: {term}")
            return "\n".join(lines)

        elif query_type == "weekday":
            wd = WEEKDAYS_CN[ref_date.weekday()]
            return f"{ref_date} 是 {wd}"

        elif query_type == "solar_term":
            if target_date:
                term = _get_solar_term(ref_date)
                if term:
                    return f"{ref_date} 的节气是: {term}"
                # Find the nearest term
                terms = list(SOLAR_TERMS)
                for i, (name, m, (start, end)) in enumerate(terms):
                    term_date = date(ref_date.year, m, (start + end) // 2)
                    if term_date > ref_date:
                        prev_name, prev_m, (ps, pe) = terms[i - 1] if i > 0 else terms[-1]
                        prev_year = ref_date.year if i > 0 else ref_date.year - 1
                        prev_date = date(prev_year, prev_m, (ps + pe) // 2)
                        return f"{ref_date} 无对应节气。上一个节气: {prev_name} (约{prev_date})，下一个节气: {name} (约{term_date})"
                return f"无法确定 {ref_date} 的节气"
            # List all terms for the year
            terms = _get_all_solar_terms(ref_date.year)
            lines = [f"{ref_date.year}年 二十四节气:"]
            for name, approx in terms.items():
                lines.append(f"  {name}: {approx}")
            return "\n".join(lines)

        elif query_type == "countdown":
            if not target_date:
                return "错误: countdown 需要指定 target_date 参数，例如 target_date='2027-01-01'"
            today = now.date()
            delta = ref_date - today
            if delta.days < 0:
                return f"距离 {target_date} 已过去 {-delta.days} 天"
            elif delta.days == 0:
                return "就是今天！"
            else:
                return f"距离 {target_date} 还有 {delta.days} 天"

        elif query_type == "timezone_convert":
            if not target_timezone:
                return "错误: timezone_convert 需要指定 target_timezone 参数"
            try:
                src_tz = ZoneInfo(timezone)
                dst_tz = ZoneInfo(target_timezone)
            except Exception as e:
                return f"时区无效: {e}"
            src_dt = datetime(ref_date.year, ref_date.month, ref_date.day,
                              now.hour, now.minute, now.second, tzinfo=src_tz)
            dst_dt = src_dt.astimezone(dst_tz)
            return (f"{src_dt.strftime('%Y-%m-%d %H:%M:%S')} ({timezone}) = "
                    f"{dst_dt.strftime('%Y-%m-%d %H:%M:%S')} ({target_timezone})")

        elif query_type == "lunar":
            try:
                from zhdate import ZhDate
                lunar = ZhDate.from_datetime(datetime(ref_date.year, ref_date.month, ref_date.day))
                gs = _ganzhi_year(ref_date.year)
                return (
                    f"公历: {ref_date}\n"
                    f"农历: {gs}{lunar.lunar_year}年 {lunar.lunar_month}月{lunar.lunar_day}日\n"
                    f"生肖: {_zodiac_year(ref_date.year)}"
                )
            except ImportError:
                return "农历查询不可用: zhdate 包未安装，请运行 pip install zhdate"

        elif query_type == "holiday":
            key_solar = (ref_date.month, ref_date.day)
            if key_solar in CN_HOLIDAYS_SOLAR:
                return f"{ref_date} 是 {CN_HOLIDAYS_SOLAR[key_solar]}"
            try:
                from zhdate import ZhDate
                lunar = ZhDate.from_datetime(datetime(ref_date.year, ref_date.month, ref_date.day))
                key_lunar = (lunar.lunar_month, lunar.lunar_day)
                if key_lunar in CN_HOLIDAYS_LUNAR:
                    return f"{ref_date} 是 {CN_HOLIDAYS_LUNAR[key_lunar]}（农历）"
                # Also check the next day for lunar holidays (boundary cases)
                next_dt = datetime(ref_date.year, ref_date.month, ref_date.day) + timedelta(days=1)
                lunar_next = ZhDate.from_datetime(next_dt)
                key_lunar_next = (lunar_next.lunar_month, lunar_next.lunar_day)
                if key_lunar_next in CN_HOLIDAYS_LUNAR:
                    return f"{ref_date} 临近 {CN_HOLIDAYS_LUNAR[key_lunar_next]}（农历，约1天后）"
            except ImportError:
                pass
            return f"{ref_date} 不是已知的中国节假日"

        else:
            valid = "current, weekday, solar_term, countdown, timezone_convert, lunar, holiday"
            return f"未知的 query_type: '{query_type}'。支持的类型: {valid}"

    except Exception as e:
        return f"时间查询出错: {e}"
