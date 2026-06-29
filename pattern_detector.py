"""
pattern_detector.py — Reliable Pattern Library (detector determinístico)

Detecta los 5 patrones de price action con menor tasa de fallo documentada
(Bulkowski, Encyclopedia of Chart Patterns) sobre una serie OHLCV. No usa
heurísticas verbales ni "se ve parecido" — cada patrón tiene una regla de
detección, confirmación e invalidación codificada explícitamente sobre los
datos numéricos reales del input.

Principios (mismos que engine.py):
  1. Si no hay suficientes datos para verificar una condición, NO se asume
     que se cumple. Se reporta como no detectado / no confirmado.
  2. Las tasas de fallo son las documentadas por Bulkowski para la condición
     de formación "clean". Si la formación es "loose" o "ambiguous", el
     detector lo marca explícitamente y el caller (la skill / el motor de
     confluencia) decide no otorgar el bonus de score.
  3. La salida está pensada para insertarse directamente en el payload de
     engine.py (quantitative-confluence-strategist) bajo la clave
     "pattern_detected".

Uso:
    from pattern_detector import detect_patterns
    result = detect_patterns(candles)  # lista de dicts OHLCV
    payload["pattern_detected"] = result  # se inserta en el payload del motor principal

CLI (stdin/stdout JSON), igual convención que engine.py:
    cat candles.json | python3 pattern_detector.py
"""

from __future__ import annotations
import json
import sys
import statistics
from dataclasses import dataclass, field
from typing import Optional


# --------------------------------------------------------------------------
# Tasas de fallo documentadas (Bulkowski / Encyclopedia of Chart Patterns)
# Estas cifras son para la condición de formación "clean" en gráficos diarios
# de acciones US. Ver nota de calibración en SKILL.md para cripto/intradía.
# --------------------------------------------------------------------------

DOCUMENTED_FAILURE_RATES = {
    "inverse_head_and_shoulders": 11,
    "head_and_shoulders_top": 14,
    "high_tight_bull_flag": 15,
    "loose_bull_flag": 55,
    "double_bottom": 16,
    "ascending_triangle": 17,
    "descending_triangle": 18,
}


@dataclass
class PatternMatch:
    name: str
    documented_failure_rate_pct: int
    formation_quality: str  # "clean" | "loose" | "ambiguous"
    invalidation_price: Optional[float]
    confirmation_condition_met: bool
    target_price: Optional[float] = None
    details: list[str] = field(default_factory=list)


def _no_pattern() -> dict:
    return {
        "name": None,
        "documented_failure_rate_pct": None,
        "formation_quality": None,
        "invalidation_price": None,
        "confirmation_condition_met": False,
        "target_price": None,
        "details": ["No se detectó ningún patrón de la librería con los datos disponibles."],
    }


def _to_dict(match: PatternMatch) -> dict:
    return {
        "name": match.name,
        "documented_failure_rate_pct": match.documented_failure_rate_pct,
        "formation_quality": match.formation_quality,
        "invalidation_price": match.invalidation_price,
        "confirmation_condition_met": match.confirmation_condition_met,
        "target_price": match.target_price,
        "details": match.details,
    }


# --------------------------------------------------------------------------
# Utilidades de swings (mínimos/máximos locales) — base para todos los patrones
# --------------------------------------------------------------------------

def _find_local_minima(candles: list[dict], window: int = 2) -> list[tuple[int, float]]:
    """Devuelve [(índice, precio_low)] de mínimos locales con ventana +/- window velas.
    Usa comparación estricta en los vecinos (no en el propio punto) para que un mínimo
    plano de varias velas consecutivas no se pierda por empates."""
    minima = []
    n = len(candles)
    for i in range(window, n - window):
        low = candles[i]["low"]
        neighborhood = [candles[j]["low"] for j in range(i - window, i + window + 1) if j != i]
        if all(low <= v for v in neighborhood) and any(low < v for v in neighborhood):
            minima.append((i, low))
    return minima


def _find_local_maxima(candles: list[dict], window: int = 2) -> list[tuple[int, float]]:
    maxima = []
    n = len(candles)
    for i in range(window, n - window):
        high = candles[i]["high"]
        neighborhood = [candles[j]["high"] for j in range(i - window, i + window + 1) if j != i]
        if all(high >= v for v in neighborhood) and any(high > v for v in neighborhood):
            maxima.append((i, high))
    return maxima


def _volume_confirmed(candles: list[dict], idx: int, periods: int = 20) -> bool:
    if idx < periods:
        return False
    avg_vol = statistics.fmean(c["volume"] for c in candles[idx - periods:idx])
    if avg_vol <= 0:
        return False
    return candles[idx]["volume"] > avg_vol


# --------------------------------------------------------------------------
# Patrón: Double Bottom (~16% fallo documentado)
# --------------------------------------------------------------------------

def detect_double_bottom(candles: list[dict]) -> Optional[PatternMatch]:
    minima = _find_local_minima(candles)
    if len(minima) < 2:
        return None

    idx1, low1 = minima[-2]
    idx2, low2 = minima[-1]

    if idx2 <= idx1:
        return None

    diff_pct = abs(low1 - low2) / low1 * 100 if low1 else 100
    if diff_pct > 5:
        return None  # no son "aproximadamente iguales" -> no es un double bottom válido

    between = candles[idx1:idx2 + 1]
    if not between:
        return None
    resistance = max(c["high"] for c in between)

    last_close = candles[-1]["close"]
    confirmed = last_close > resistance

    quality = "clean" if diff_pct <= 3 else "ambiguous"

    invalidation = min(low1, low2)
    target = resistance + (resistance - min(low1, low2)) if confirmed else None

    details = [
        f"Suelo 1 @ idx {idx1} = {low1}, Suelo 2 @ idx {idx2} = {low2} (diff {diff_pct:.1f}%)",
        f"Resistencia intermedia = {resistance}",
        f"Confirmado: {confirmed} (último close = {last_close})",
    ]

    return PatternMatch(
        name="double_bottom",
        documented_failure_rate_pct=DOCUMENTED_FAILURE_RATES["double_bottom"],
        formation_quality=quality,
        invalidation_price=invalidation,
        confirmation_condition_met=confirmed,
        target_price=target,
        details=details,
    )


# --------------------------------------------------------------------------
# Patrón: Inverse Head & Shoulders (~11% fallo, el mejor documentado)
# --------------------------------------------------------------------------

def detect_inverse_head_and_shoulders(candles: list[dict]) -> Optional[PatternMatch]:
    minima = _find_local_minima(candles)
    if len(minima) < 3:
        return None

    (idx_l, low_l), (idx_h, low_h), (idx_r, low_r) = minima[-3:]
    if not (idx_l < idx_h < idx_r):
        return None

    # La cabeza debe ser el mínimo más bajo de los tres
    if not (low_h < low_l and low_h < low_r):
        return None

    shoulder_diff_pct = abs(low_l - low_r) / low_l * 100 if low_l else 100
    quality = "clean" if shoulder_diff_pct <= 5 else "ambiguous"

    maxima_between = [m for m in _find_local_maxima(candles) if idx_l < m[0] < idx_r]
    if not maxima_between:
        return None
    neckline = statistics.fmean(m[1] for m in maxima_between)

    last_close = candles[-1]["close"]
    confirmed = last_close > neckline

    invalidation = low_r  # cierre de vuelta por debajo del hombro derecho invalida
    target = neckline + (neckline - low_h) if confirmed else None

    details = [
        f"Hombro izq @ idx {idx_l} = {low_l}, Cabeza @ idx {idx_h} = {low_h}, Hombro der @ idx {idx_r} = {low_r}",
        f"Neckline (promedio de máximos intermedios) = {neckline:.4f}",
        f"Confirmado: {confirmed} (último close = {last_close})",
    ]

    return PatternMatch(
        name="inverse_head_and_shoulders",
        documented_failure_rate_pct=DOCUMENTED_FAILURE_RATES["inverse_head_and_shoulders"],
        formation_quality=quality,
        invalidation_price=invalidation,
        confirmation_condition_met=confirmed,
        target_price=target,
        details=details,
    )


# --------------------------------------------------------------------------
# Patrón: Head & Shoulders Top (~14% fallo) — espejo del anterior
# --------------------------------------------------------------------------

def detect_head_and_shoulders_top(candles: list[dict]) -> Optional[PatternMatch]:
    maxima = _find_local_maxima(candles)
    if len(maxima) < 3:
        return None

    (idx_l, high_l), (idx_h, high_h), (idx_r, high_r) = maxima[-3:]
    if not (idx_l < idx_h < idx_r):
        return None

    if not (high_h > high_l and high_h > high_r):
        return None

    shoulder_diff_pct = abs(high_l - high_r) / high_l * 100 if high_l else 100
    quality = "clean" if shoulder_diff_pct <= 5 else "ambiguous"

    minima_between = [m for m in _find_local_minima(candles) if idx_l < m[0] < idx_r]
    if not minima_between:
        return None
    neckline = statistics.fmean(m[1] for m in minima_between)

    last_close = candles[-1]["close"]
    confirmed = last_close < neckline

    invalidation = high_r  # cierre de vuelta por encima del hombro derecho invalida
    target = neckline - (high_h - neckline) if confirmed else None

    details = [
        f"Hombro izq @ idx {idx_l} = {high_l}, Cabeza @ idx {idx_h} = {high_h}, Hombro der @ idx {idx_r} = {high_r}",
        f"Neckline (promedio de mínimos intermedios) = {neckline:.4f}",
        f"Confirmado: {confirmed} (último close = {last_close})",
    ]

    return PatternMatch(
        name="head_and_shoulders_top",
        documented_failure_rate_pct=DOCUMENTED_FAILURE_RATES["head_and_shoulders_top"],
        formation_quality=quality,
        invalidation_price=invalidation,
        confirmation_condition_met=confirmed,
        target_price=target,
        details=details,
    )


# --------------------------------------------------------------------------
# Patrón: Bull Flag — high-tight (~15% fallo) vs loose (~55% fallo)
# --------------------------------------------------------------------------

def detect_bull_flag(candles: list[dict], min_pole_candles: int = 3) -> Optional[PatternMatch]:
    if len(candles) < min_pole_candles + 3:
        return None

    # Mástil: al menos `min_pole_candles` cierres consecutivos alcistas fuertes
    # justo antes de la posible consolidación.
    pole_window = candles[-(min_pole_candles + 5):-5] if len(candles) >= min_pole_candles + 5 else candles[:-5]
    if len(pole_window) < min_pole_candles:
        return None

    consecutive_strong_up = 0
    for c in pole_window[-min_pole_candles:]:
        if c["close"] > c["open"]:
            consecutive_strong_up += 1

    pole_confirmed = consecutive_strong_up >= min_pole_candles
    quality = "clean" if pole_confirmed else "loose"
    failure_key = "high_tight_bull_flag" if pole_confirmed else "loose_bull_flag"

    # La bandera es la consolidación ANTES de la posible vela de ruptura.
    # Separar explícitamente para no contaminar el chequeo de "volumen decreciente
    # dentro de la bandera" con el volumen típicamente alto de la vela de breakout.
    flag_window = candles[-5:-1]
    breakout_candle = candles[-1]

    if len(flag_window) < 3:
        return None

    flag_high = max(c["high"] for c in flag_window)
    flag_low = min(c["low"] for c in flag_window)

    vol_first_half = statistics.fmean(c["volume"] for c in flag_window[:len(flag_window) // 2])
    vol_second_half = statistics.fmean(c["volume"] for c in flag_window[len(flag_window) // 2:])
    volume_decreasing = vol_second_half < vol_first_half

    last_close = breakout_candle["close"]
    confirmed = last_close > flag_high and volume_decreasing

    invalidation = flag_low
    pole_height = max(c["high"] for c in pole_window) - min(c["low"] for c in pole_window) if pole_window else 0
    target = flag_high + pole_height if confirmed and pole_height > 0 else None

    details = [
        f"Mástil: {consecutive_strong_up}/{min_pole_candles} cierres alcistas consecutivos (pole_confirmed={pole_confirmed})",
        f"Bandera: high={flag_high}, low={flag_low}, volumen decreciente={volume_decreasing}",
        f"Confirmado breakout: {confirmed}",
    ]

    return PatternMatch(
        name=failure_key,
        documented_failure_rate_pct=DOCUMENTED_FAILURE_RATES[failure_key],
        formation_quality=quality,
        invalidation_price=invalidation,
        confirmation_condition_met=confirmed,
        target_price=target,
        details=details,
    )


# --------------------------------------------------------------------------
# Patrón: Ascending / Descending Triangle (~17-18% fallo)
# --------------------------------------------------------------------------

def detect_triangle(candles: list[dict], lookback: int = 15, segments: int = 5) -> Optional[PatternMatch]:
    """
    No depende de encontrar 'valles' aislados (un soporte ascendente monotónico no
    tiene valles en el sentido pico/valle clásico). En su lugar, divide la ventana en
    segmentos consecutivos y mide el mínimo y máximo de cada segmento, evaluando la
    pendiente de esa secuencia — esto detecta correctamente tanto un soporte ascendente
    recto como una resistencia plana, sin falsos negativos por monotonicidad.
    """
    if len(candles) < lookback:
        return None

    breakout_candle = candles[-1]
    window = candles[-lookback:-1]  # la formación, excluyendo la posible vela de ruptura
    if len(window) < segments:
        return None

    seg_size = max(1, len(window) // segments)
    seg_lows = []
    seg_highs = []
    for i in range(0, len(window), seg_size):
        seg = window[i:i + seg_size]
        if not seg:
            continue
        seg_lows.append(min(c["low"] for c in seg))
        seg_highs.append(max(c["high"] for c in seg))

    if len(seg_lows) < 3 or len(seg_highs) < 3:
        return None

    last_close = breakout_candle["close"]

    # Soporte ascendente: cada segmento tiene un mínimo igual o mayor al anterior,
    # con una mejora neta total significativa (no ruido plano).
    rising_lows = all(seg_lows[i] <= seg_lows[i + 1] + 1e-9 for i in range(len(seg_lows) - 1))
    net_rise = (seg_lows[-1] - seg_lows[0]) / seg_lows[0] if seg_lows[0] else 0
    resistance_range = (max(seg_highs) - min(seg_highs)) / max(seg_highs) if max(seg_highs) else 1
    flat_resistance = resistance_range < 0.03

    falling_highs = all(seg_highs[i] >= seg_highs[i + 1] - 1e-9 for i in range(len(seg_highs) - 1))
    net_fall = (seg_highs[0] - seg_highs[-1]) / seg_highs[0] if seg_highs[0] else 0
    support_range = (max(seg_lows) - min(seg_lows)) / max(seg_lows) if max(seg_lows) else 1
    flat_support = support_range < 0.03

    if rising_lows and net_rise > 0.005 and flat_resistance:
        resistance = statistics.fmean(seg_highs)
        confirmed = last_close > resistance
        invalidation = seg_lows[-1]
        triangle_height = resistance - seg_lows[0]
        target = resistance + triangle_height if confirmed else None
        return PatternMatch(
            name="ascending_triangle",
            documented_failure_rate_pct=DOCUMENTED_FAILURE_RATES["ascending_triangle"],
            formation_quality="clean",
            invalidation_price=invalidation,
            confirmation_condition_met=confirmed,
            target_price=target,
            details=[
                f"Resistencia plana ~{resistance:.4f} (rango {resistance_range:.1%}), soporte ascendente de {seg_lows[0]:.2f} a {seg_lows[-1]:.2f}",
                f"Confirmado breakout alcista: {confirmed} (recordar: solo ~63% de estos rompe al alza)",
            ],
        )

    if falling_highs and net_fall > 0.005 and flat_support:
        support = statistics.fmean(seg_lows)
        confirmed = last_close < support
        invalidation = seg_highs[-1]
        triangle_height = seg_highs[0] - support
        target = support - triangle_height if confirmed else None
        return PatternMatch(
            name="descending_triangle",
            documented_failure_rate_pct=DOCUMENTED_FAILURE_RATES["descending_triangle"],
            formation_quality="clean",
            invalidation_price=invalidation,
            confirmation_condition_met=confirmed,
            target_price=target,
            details=[
                f"Soporte plano ~{support:.4f} (rango {support_range:.1%}), resistencia descendente de {seg_highs[0]:.2f} a {seg_highs[-1]:.2f}",
                f"Confirmado breakout bajista: {confirmed}",
            ],
        )

    return None


# --------------------------------------------------------------------------
# Motor principal — evalúa todos los patrones y devuelve el de mayor confianza
# --------------------------------------------------------------------------

def detect_patterns(candles: list[dict]) -> dict:
    if not candles or len(candles) < 8:
        result = _no_pattern()
        result["details"] = ["Velas insuficientes (< 8) para evaluar cualquier patrón de la librería."]
        return result

    detectors = [
        detect_inverse_head_and_shoulders,
        detect_head_and_shoulders_top,
        detect_double_bottom,
        detect_bull_flag,
        detect_triangle,
    ]

    matches = []
    for fn in detectors:
        try:
            m = fn(candles)
            if m is not None:
                matches.append(m)
        except (KeyError, ZeroDivisionError, statistics.StatisticsError):
            continue  # datos insuficientes/inválidos para este detector específico -> se omite, no se asume

    if not matches:
        return _no_pattern()

    # Prioriza: confirmado > formación clean > menor tasa de fallo documentada
    matches.sort(key=lambda m: (
        not m.confirmation_condition_met,
        m.formation_quality != "clean",
        m.documented_failure_rate_pct,
    ))

    return _to_dict(matches[0])


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------

if __name__ == "__main__":
    raw = sys.stdin.read()
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        print(json.dumps({"error": f"Invalid JSON input: {e}"}))
        sys.exit(1)

    candles = data["candles"] if isinstance(data, dict) and "candles" in data else data
    result = detect_patterns(candles)
    print(json.dumps(result, indent=2, default=str))
