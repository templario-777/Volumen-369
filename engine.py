"""
engine.py — Quantitative Confluence Strategist (Engine Mode)

Motor determinístico de scoring de confluencia para agentes de trading autónomos.
Sin dependencias de mercado en vivo (no llama APIs). Recibe datos crudos, devuelve
una decisión estructurada. Diseñado para ser:

  1. Determinístico: mismo input -> mismo output, siempre.
  2. Sin alucinación: nunca inventa un precio que no esté derivado del input.
  3. Fail-safe: si faltan datos, degrada el score del filtro afectado a 0
     en lugar de asumir un valor "razonable".

Uso típico desde un bot Python:

    from engine import analyze
    result = analyze(payload_dict)
    print(json.dumps(result, indent=2))

Uso desde un bot Node.js/TypeScript (subprocess):

    const { execSync } = require("child_process");
    const out = execSync(`python3 engine.py`, { input: JSON.stringify(payload) });
    const result = JSON.parse(out.toString());

(Ver bloque __main__ al final: lee JSON de stdin, escribe JSON a stdout.)

Dependencias: solo stdlib (statistics, math, json, dataclasses). No requiere
pandas/numpy para que sea trivial de correr en cualquier entorno del bot.
"""

from __future__ import annotations
import json
import sys
import statistics
from dataclasses import dataclass, field
from typing import Any, Optional


# --------------------------------------------------------------------------
# Configuración / Umbrales (centralizados para que calibrar sea un solo lugar)
# --------------------------------------------------------------------------

class Config:
    VOLUME_CLIMAX_MULTIPLIER = 2.5          # vol_relative > esto = clímax
    DISPLACEMENT_RATIO_MAX = 0.3            # desplazamiento/rango < esto = absorción
    VOL_MA_PERIODS = 20

    FIB_WAVE2_MIN = 0.382
    FIB_WAVE2_MAX = 0.618

    IMBALANCE_THRESHOLD_DEFAULT = 300.0     # %
    IMBALANCE_THRESHOLD_CRYPTO = 500.0      # %

    SCORE_EXECUTE = 75
    SCORE_WAIT = 50

    DEFAULT_RISK_PERCENT = 1.0

    TP_EXTENSIONS = {
        "TP1": 1.618,
        "TP2": 2.618,
        "TP3": 4.236,
    }


# --------------------------------------------------------------------------
# Estructuras de datos
# --------------------------------------------------------------------------

@dataclass
class FilterResult:
    score: int
    max_score: int
    confirmed: bool
    details: list[str] = field(default_factory=list)
    flags: list[str] = field(default_factory=list)


def _safe_get(d: Optional[dict], *path, default=None):
    """Navega un dict anidado sin lanzar KeyError. Devuelve default si falta algo."""
    cur = d
    for key in path:
        if cur is None or not isinstance(cur, dict) or key not in cur:
            return default
        cur = cur[key]
    return cur


# --------------------------------------------------------------------------
# Filtro 1 — Wyckoff / VSA
# --------------------------------------------------------------------------

def evaluate_wyckoff_vsa(candles: list[dict]) -> FilterResult:
    flags = []
    if not candles or len(candles) < Config.VOL_MA_PERIODS + 1:
        return FilterResult(
            score=0, max_score=25, confirmed=False,
            details=["Velas insuficientes para calcular volumen relativo (necesita >= 21)."],
            flags=["insufficient_history"],
        )

    volumes = [c["volume"] for c in candles]
    vol_ma = statistics.fmean(volumes[-(Config.VOL_MA_PERIODS + 1):-1])
    last = candles[-1]

    if vol_ma <= 0:
        return FilterResult(score=0, max_score=25, confirmed=False,
                             details=["Volumen promedio inválido (0 o negativo)."],
                             flags=["invalid_volume_data"])

    vol_relative = last["volume"] / vol_ma
    candle_range = last["high"] - last["low"]
    displacement = abs(last["close"] - last["open"])
    displacement_ratio = (displacement / candle_range) if candle_range > 0 else 1.0

    is_high_volume = vol_relative > Config.VOLUME_CLIMAX_MULTIPLIER
    is_low_displacement = displacement_ratio < Config.DISPLACEMENT_RATIO_MAX
    is_bearish = last["close"] < last["open"]
    is_bullish = last["close"] > last["open"]

    score = 0
    details = [f"vol_relative={vol_relative:.2f}x, displacement_ratio={displacement_ratio:.2f}"]
    confirmed = False

    if is_high_volume and is_low_displacement:
        score += 15
        confirmed = True
        if is_bearish:
            details.append("Selling Climax detectado: volumen ultra-alto + bajo desplazamiento + vela bajista.")
        elif is_bullish:
            details.append("Buying Climax detectado: volumen ultra-alto + bajo desplazamiento + vela alcista.")
        # Absorción confirmada si la vela siguiente (si existe) no rompe el extremo del clímax
        if len(candles) >= 2:
            prev = candles[-2]
            if is_bearish and last["low"] >= prev.get("low", last["low"]):
                score += 10
                details.append("Sin ruptura del extremo del clímax — absorción confirmada.")
            elif is_bullish and last["high"] <= prev.get("high", last["high"]):
                score += 10
                details.append("Sin ruptura del extremo del clímax — absorción confirmada.")
    else:
        details.append("No se detecta evento de clímax en la última vela.")

    return FilterResult(score=min(score, 25), max_score=25, confirmed=confirmed,
                         details=details, flags=flags)


# --------------------------------------------------------------------------
# Filtro 2 — Estructura Elliott
# --------------------------------------------------------------------------

def evaluate_elliott(candles: list[dict]) -> FilterResult:
    """
    Heurística simplificada y determinística: usa el swing-high/low más reciente
    como proxy de fin de Onda 1, y el retroceso posterior como Onda 2.
    No sustituye un conteo manual experto — es una aproximación auditable y
    explícita sobre datos reales, nunca un conteo inventado.
    """
    flags = []
    min_candles = 15
    if not candles or len(candles) < min_candles:
        return FilterResult(
            score=0, max_score=25, confirmed=False,
            details=[f"Velas insuficientes para conteo Elliott (necesita >= {min_candles})."],
            flags=["insufficient_history"],
        )

    closes = [c["close"] for c in candles]
    highs = [c["high"] for c in candles]
    lows = [c["low"] for c in candles]

    # Proxy de Onda 1: tramo desde el mínimo más bajo reciente hasta el máximo más alto posterior
    window = candles[-min_candles:]
    w_lows = [c["low"] for c in window]
    w_highs = [c["high"] for c in window]
    wave1_start_idx = w_lows.index(min(w_lows))
    wave1_start = w_lows[wave1_start_idx]

    post_wave1 = w_highs[wave1_start_idx:]
    if not post_wave1:
        return FilterResult(score=0, max_score=25, confirmed=False,
                             details=["No se pudo aislar un tramo de Onda 1 con los datos disponibles."],
                             flags=["elliott_count_ambiguous"])

    wave1_end = max(post_wave1)
    wave1_size = wave1_end - wave1_start

    if wave1_size <= 0:
        return FilterResult(score=0, max_score=25, confirmed=False,
                             details=["Onda 1 inválida: tamaño <= 0 con los datos disponibles."],
                             flags=["elliott_count_ambiguous"])

    current_price = closes[-1]
    retracement = (wave1_end - current_price) / wave1_size if wave1_size else 0

    structure_valid = current_price > wave1_start  # invalidación dura: no perforar origen de Onda 1
    wave2_in_zone = Config.FIB_WAVE2_MIN <= retracement <= Config.FIB_WAVE2_MAX

    score = 0
    details = [
        f"wave1_start={wave1_start}, wave1_end={wave1_end}, retracement_actual={retracement:.2%}"
    ]

    if not structure_valid:
        details.append("INVALIDACIÓN: precio actual perforó el origen de Onda 1. Conteo descartado.")
        return FilterResult(score=0, max_score=25, confirmed=False, details=details,
                             flags=["elliott_structure_invalidated"])

    if wave2_in_zone:
        score += 15
        details.append("Retroceso actual dentro de zona típica de fin de Onda 2 (38.2%-61.8%).")
        score += 10
        confirmed = True
    else:
        details.append("Retroceso fuera de zona típica de Onda 2 — estructura plausible pero no confirmada.")
        score = 10
        confirmed = False
        flags.append("elliott_count_ambiguous")

    tp_levels = {
        name: wave1_end + wave1_size * mult
        for name, mult in Config.TP_EXTENSIONS.items()
    }

    return FilterResult(score=min(score, 25), max_score=25, confirmed=confirmed,
                         details=details + [f"Proyecciones TP (extensión de Onda 1): {tp_levels}"],
                         flags=flags)


# --------------------------------------------------------------------------
# Filtro 3 — Order Flow / Footprint
# --------------------------------------------------------------------------

def evaluate_order_flow(footprint: Optional[dict], is_crypto: bool = False) -> FilterResult:
    if not footprint:
        return FilterResult(score=0, max_score=25, confirmed=False,
                             details=["No se recibió objeto 'footprint' en el input."],
                             flags=["missing_footprint"])

    bid = footprint.get("bid_volume")
    ask = footprint.get("ask_volume")
    delta = footprint.get("delta")

    if bid is None or ask is None or bid <= 0 or ask <= 0:
        return FilterResult(score=0, max_score=25, confirmed=False,
                             details=["bid_volume/ask_volume ausentes o inválidos en footprint."],
                             flags=["missing_footprint"])

    threshold = Config.IMBALANCE_THRESHOLD_CRYPTO if is_crypto else Config.IMBALANCE_THRESHOLD_DEFAULT
    imbalance_pct = (max(ask, bid) / min(ask, bid)) * 100

    score = 0
    details = [f"imbalance_pct={imbalance_pct:.1f}% (umbral={threshold:.0f}%)"]
    confirmed = False

    if imbalance_pct >= threshold:
        confirmed = True
        bonus = min(15, int((imbalance_pct / threshold) * 10))
        score += bonus
        details.append(f"Imbalance supera umbral — score parcial {bonus}/15.")
    else:
        details.append("Imbalance por debajo del umbral crítico.")

    if delta is not None and abs(delta) > 0:
        score += 10
        details.append(f"Delta acumulado presente ({delta}) — se suma como confirmación de presión direccional.")

    return FilterResult(score=min(score, 25), max_score=25, confirmed=confirmed,
                         details=details, flags=[])


# --------------------------------------------------------------------------
# Filtro 4 — EMAs
# --------------------------------------------------------------------------

def evaluate_emas(indicators: Optional[dict], candles: list[dict]) -> FilterResult:
    ema_9 = _safe_get(indicators, "ema_9")
    ema_21 = _safe_get(indicators, "ema_21")
    ema_50 = _safe_get(indicators, "ema_50")

    if ema_9 is None or ema_21 is None or ema_50 is None:
        return FilterResult(score=0, max_score=25, confirmed=False,
                             details=["EMAs (9/21/50) ausentes en 'indicators'."],
                             flags=["missing_emas"])

    aligned_bull = ema_9 > ema_21 > ema_50
    aligned_bear = ema_9 < ema_21 < ema_50
    aligned = aligned_bull or aligned_bear

    # Cruce reciente: requiere al menos 2 velas con close para comparar contra EMA21 anterior.
    # Sin histórico de EMAs previas no podemos confirmar el cruce con certeza -> degradamos a "plausible".
    cross_recent = None
    if len(candles) >= 2:
        prev_close = candles[-2]["close"]
        last_close = candles[-1]["close"]
        # Proxy: si el close cruzó la EMA21 entre la vela anterior y la actual.
        cross_recent = (prev_close < ema_21 <= last_close) or (prev_close > ema_21 >= last_close)

    score = 0
    details = [f"ema_9={ema_9}, ema_21={ema_21}, ema_50={ema_50}, aligned={aligned}"]

    if cross_recent:
        score += 15
        details.append("Cruce de precio sobre/bajo EMA21 detectado en la última vela.")
    else:
        details.append("No se confirma cruce reciente con los datos disponibles.")

    if aligned:
        score += 10
        details.append(f"EMAs alineadas ({'alcista' if aligned_bull else 'bajista'}).")

    return FilterResult(score=min(score, 25), max_score=25, confirmed=aligned and bool(cross_recent),
                         details=details, flags=[])


# --------------------------------------------------------------------------
# Position sizing
# --------------------------------------------------------------------------

def calculate_position_size(
    capital_usd: float,
    risk_percent: float,
    entry_price: float,
    stop_loss_price: float,
) -> dict:
    risk_amount = capital_usd * (risk_percent / 100)
    stop_distance = abs(entry_price - stop_loss_price)
    if stop_distance <= 0:
        return {
            "risk_amount_usd": round(risk_amount, 2),
            "stop_distance": 0,
            "position_size": None,
            "unit": "units",
            "error": "stop_distance es 0 — no se puede calcular tamaño de posición.",
        }
    position_size = risk_amount / stop_distance
    return {
        "risk_amount_usd": round(risk_amount, 2),
        "stop_distance": round(stop_distance, 8),
        "position_size": round(position_size, 8),
        "unit": "units",
    }


# --------------------------------------------------------------------------
# Motor principal
# --------------------------------------------------------------------------

def analyze(payload: dict) -> dict:
    symbol = payload.get("symbol", "UNKNOWN")
    timeframe = payload.get("timeframe", "UNKNOWN")
    candles = payload.get("candles") or []
    footprint = payload.get("footprint")
    indicators = payload.get("indicators")
    account = payload.get("account") or {}
    open_position = payload.get("open_position")

    is_crypto = symbol.upper().endswith("USDT") or symbol.upper().endswith("USD")

    # Gestión de posición abierta tiene su propio flujo, separado del de entrada nueva.
    if open_position:
        return _manage_open_position(symbol, candles, open_position)

    if len(candles) < 5:
        return {
            "symbol": symbol,
            "timeframe": timeframe,
            "confluence_score": {"total": 0, "wyckoff_vsa": 0, "elliott": 0, "order_flow": 0, "emas": 0},
            "data_quality_flags": ["insufficient_data_to_analyze"],
            "decision": "NO_TRADE",
            "setup": None,
            "position_sizing": None,
            "reasoning_summary": "Menos de 5 velas en el input — no se puede analizar con datos reales.",
        }

    wyckoff = evaluate_wyckoff_vsa(candles)
    elliott = evaluate_elliott(candles)
    order_flow = evaluate_order_flow(footprint, is_crypto=is_crypto)
    emas = evaluate_emas(indicators, candles)

    total = wyckoff.score + elliott.score + order_flow.score + emas.score

    flags = list(set(wyckoff.flags + elliott.flags + order_flow.flags + emas.flags))

    if total >= Config.SCORE_EXECUTE:
        decision = "EXECUTE"
    elif total >= Config.SCORE_WAIT:
        decision = "WAIT"
    else:
        decision = "NO_TRADE"

    setup = None
    position_sizing = None

    if decision == "EXECUTE":
        last_close = candles[-1]["close"]
        last_low = candles[-1]["low"]
        last_high = candles[-1]["high"]

        # Dirección inferida del estado de EMAs/última vela — siempre con datos reales del input.
        ema_9 = _safe_get(indicators, "ema_9")
        ema_21 = _safe_get(indicators, "ema_21")
        direction = None
        if ema_9 is not None and ema_21 is not None:
            direction = "long" if ema_9 > ema_21 else "short"

        if direction is None:
            flags.append("price_derivation_failed")
            decision = "WAIT"
        else:
            entry_price = last_close
            if direction == "long":
                stop_loss = min(last_low, candles[-2]["low"] if len(candles) >= 2 else last_low)
            else:
                stop_loss = max(last_high, candles[-2]["high"] if len(candles) >= 2 else last_high)

            stop_distance = abs(entry_price - stop_loss)
            if stop_distance <= 0:
                flags.append("price_derivation_failed")
                decision = "WAIT"
            else:
                mult = 1 if direction == "long" else -1
                take_profit = [
                    round(entry_price + mult * stop_distance * ext, 8)
                    for ext in Config.TP_EXTENSIONS.values()
                ]
                risk_reward = [round(abs(tp - entry_price) / stop_distance, 2) for tp in take_profit]

                setup = {
                    "direction": direction,
                    "entry_price": entry_price,
                    "stop_loss": round(stop_loss, 8),
                    "stop_loss_invalidation_reason": "Extremo de la vela de señal / vela previa (estructura local).",
                    "take_profit": take_profit,
                    "risk_reward": risk_reward,
                }

                capital_usd = account.get("capital_usd")
                risk_percent = account.get("risk_percent", Config.DEFAULT_RISK_PERCENT)
                if capital_usd:
                    position_sizing = calculate_position_size(
                        capital_usd, risk_percent, entry_price, stop_loss
                    )

    return {
        "symbol": symbol,
        "timeframe": timeframe,
        "confluence_score": {
            "total": total,
            "wyckoff_vsa": wyckoff.score,
            "elliott": elliott.score,
            "order_flow": order_flow.score,
            "emas": emas.score,
        },
        "data_quality_flags": flags,
        "decision": decision,
        "setup": setup,
        "position_sizing": position_sizing,
        "early_exit_conditions": [
            "ATR se expande > 2x media(14)",
            "Volumen climático contrario a la dirección del trade",
            "Cierre de vela viola EMA 50",
            "Delta acumulado revierte > 60% sin nuevo impulso",
        ],
        "filter_details": {
            "wyckoff_vsa": wyckoff.details,
            "elliott": elliott.details,
            "order_flow": order_flow.details,
            "emas": emas.details,
        },
        "reasoning_summary": (
            f"Score {total}/100 ({decision}). "
            f"Wyckoff={wyckoff.score}, Elliott={elliott.score}, "
            f"OrderFlow={order_flow.score}, EMAs={emas.score}."
        ),
    }


def _manage_open_position(symbol: str, candles: list[dict], open_position: dict) -> dict:
    if not candles:
        return {
            "symbol": symbol,
            "action": "HOLD",
            "reason": "Sin velas en el input — no se puede evaluar la posición de forma segura.",
            "new_stop_loss": None,
            "partial_close_percent": None,
        }

    last_close = candles[-1]["close"]
    side = open_position.get("side")
    current_tp = open_position.get("current_tp") or []
    current_sl = open_position.get("current_sl")

    tp1 = current_tp[0] if len(current_tp) > 0 else None
    entry_price = open_position.get("entry_price")

    hit_tp1 = False
    if tp1 is not None and entry_price is not None:
        if side == "long":
            hit_tp1 = last_close >= tp1
        elif side == "short":
            hit_tp1 = last_close <= tp1

    if hit_tp1 and current_sl is not None and current_sl != entry_price:
        return {
            "symbol": symbol,
            "action": "MOVE_SL_BREAKEVEN",
            "reason": f"Precio actual ({last_close}) alcanzó TP1 ({tp1}).",
            "new_stop_loss": entry_price,
            "partial_close_percent": None,
        }

    return {
        "symbol": symbol,
        "action": "HOLD",
        "reason": "Ninguna condición de salida activa con los datos disponibles.",
        "new_stop_loss": None,
        "partial_close_percent": None,
    }


# --------------------------------------------------------------------------
# CLI / stdin-stdout para integración cross-language (ej. Node.js subprocess)
# --------------------------------------------------------------------------

if __name__ == "__main__":
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as e:
        print(json.dumps({"error": f"Invalid JSON input: {e}"}))
        sys.exit(1)

    result = analyze(payload)
    print(json.dumps(result, indent=2, default=str))
