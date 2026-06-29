"""
breakout_screener.py - Escáner de Breakout con 3 filtros:
1. Squeeze de Volatilidad (Bandas de Bollinger)
2. Anomalía de Volumen Acumulativo
3. Proximidad a Bloques de Órdenes (Resistencias)
"""

import statistics
from typing import List, Dict, Optional


def calculate_bollinger_bands(
    closes: List[float],
    period: int = 20,
    std_dev_multiplier: float = 2.0
) -> Dict[str, List[float]]:
    """
    Calcula las Bandas de Bollinger.
    
    Returns:
        Dict con:
        - middle_band: Media móvil
        - upper_band: Banda superior
        - lower_band: Banda inferior
        - bandwidth: Ancho de las bandas (normalizado)
    """
    middle_band = []
    upper_band = []
    lower_band = []
    bandwidth = []

    for i in range(len(closes)):
        if i < period - 1:
            middle_band.append(None)
            upper_band.append(None)
            lower_band.append(None)
            bandwidth.append(None)
        else:
            slice_closes = closes[i - period + 1 : i + 1]
            sma = statistics.fmean(slice_closes)
            std = statistics.stdev(slice_closes)
            upper = sma + (std_dev_multiplier * std)
            lower = sma - (std_dev_multiplier * std)
            bw = (upper - lower) / sma if sma != 0 else 0

            middle_band.append(sma)
            upper_band.append(upper)
            lower_band.append(lower)
            bandwidth.append(bw)

    return {
        "middle_band": middle_band,
        "upper_band": upper_band,
        "lower_band": lower_band,
        "bandwidth": bandwidth
    }


def calculate_volume_sma(volumes: List[float], period: int = 20) -> List[Optional[float]]:
    """Calcula la media móvil de volumen."""
    volume_sma = []
    for i in range(len(volumes)):
        if i < period - 1:
            volume_sma.append(None)
        else:
            slice_volumes = volumes[i - period + 1 : i + 1]
            volume_sma.append(statistics.fmean(slice_volumes))
    return volume_sma


def find_recent_resistances(
    highs: List[float],
    lookback: int = 60,
    equal_tolerance: float = 0.002  # 0.2% de tolerancia para igualar máximos
) -> List[float]:
    """
    Encuentra resistencias importantes recientes (Equal Highs).
    
    Returns:
        Lista de precios de resistencia importantes
    """
    resistances = []
    
    # Ventana reciente
    recent_highs = highs[-lookback:] if len(highs) > lookback else highs
    
    for i in range(len(recent_highs)):
        current_high = recent_highs[i]
        # Verificar si es un máximo local
        is_local_max = True
        for j in range(max(0, i - 3), min(len(recent_highs), i + 4)):
            if j != i and recent_highs[j] > current_high * (1 - equal_tolerance):
                if recent_highs[j] > current_high * (1 + equal_tolerance):
                    is_local_max = False
                    break
        
        if is_local_max:
            # Verificar si ya existe una resistencia similar
            duplicate = False
            for res in resistances:
                if abs(current_high - res) / res < equal_tolerance:
                    duplicate = True
                    break
            
            if not duplicate:
                resistances.append(current_high)
    
    return resistances


def filter_1_bollinger_squeeze(
    closes: List[float],
    bandwidth_history: List[Optional[float]],
    upper_band: List[Optional[float]],
    squeeze_periods: int = 30,
    squeeze_threshold_percentile: float = 0.10,  # 10% más estrecho de la historia
    proximity_to_upper: float = 0.005  # 0.5% de distancia a la banda superior
) -> Dict[str, any]:
    """
    Filtro 1: Squeeze de Volatilidad.
    
    Busca:
    - Bandas de Bollinger en su punto más estrecho de los últimos N períodos
    - Precio cerca de la banda superior
    
    Returns:
        Dict con 'passed' (bool) y detalles
    """
    if len(bandwidth_history) < squeeze_periods:
        return {"passed": False, "reason": "Historial insuficiente"}

    # Filtrar valores None
    valid_bandwidths = [bw for bw in bandwidth_history[-squeeze_periods:] if bw is not None]
    
    if len(valid_bandwidths) < squeeze_periods // 2:
        return {"passed": False, "reason": "Datos de bandwidth insuficientes"}

    current_bw = bandwidth_history[-1]
    if current_bw is None:
        return {"passed": False, "reason": "Bandwidth actual no disponible"}

    # Verificar si está en el percentil más bajo
    percentile = squeeze_threshold_percentile
    threshold_index = int(len(valid_bandwidths) * percentile)
    sorted_bw = sorted(valid_bandwidths)
    threshold_bw = sorted_bw[threshold_index] if sorted_bw else float('inf')

    squeeze = current_bw <= threshold_bw

    # Verificar proximidad a la banda superior
    current_upper = upper_band[-1]
    current_close = closes[-1]
    
    near_upper = False
    if current_upper is not None and current_close is not None:
        distance = abs(current_upper - current_close) / current_upper if current_upper != 0 else float('inf')
        near_upper = distance <= proximity_to_upper

    return {
        "passed": squeeze and near_upper,
        "squeeze": squeeze,
        "near_upper": near_upper,
        "current_bandwidth": current_bw,
        "threshold_bandwidth": threshold_bw,
        "current_price": current_close,
        "upper_band": current_upper
    }


def filter_2_volume_anomaly(
    volumes: List[float],
    closes: List[float],
    volume_sma: List[Optional[float]],
    price_change_threshold: float = 0.01,  # <1% de movimiento
    volume_multiplier: float = 1.5  # 150% de la media
) -> Dict[str, any]:
    """
    Filtro 2: Anomalía de Volumen Acumulativo.
    
    Busca:
    - Precio lateralizado (<1% de movimiento)
    - Volumen >150-200% de la media
    
    Returns:
        Dict con 'passed' (bool) y detalles
    """
    if len(closes) < 5:
        return {"passed": False, "reason": "Datos insuficientes"}

    # Verificar movimiento de precio en las últimas velas
    recent_closes = closes[-5:]
    price_range = max(recent_closes) - min(recent_closes)
    avg_price = statistics.fmean(recent_closes)
    price_change = price_range / avg_price if avg_price != 0 else 0
    price_lateral = price_change <= price_change_threshold

    # Verificar volumen
    current_volume = volumes[-1]
    current_vol_sma = volume_sma[-1]
    
    volume_spike = False
    if current_volume is not None and current_vol_sma is not None and current_vol_sma > 0:
        volume_ratio = current_volume / current_vol_sma
        volume_spike = volume_ratio >= volume_multiplier

    return {
        "passed": price_lateral and volume_spike,
        "price_lateral": price_lateral,
        "volume_spike": volume_spike,
        "price_change_pct": price_change * 100,
        "volume_ratio": current_volume / current_vol_sma if (current_volume and current_vol_sma) else None,
        "current_volume": current_volume,
        "volume_sma": current_vol_sma
    }


def filter_3_proximity_to_resistance(
    current_close: float,
    resistances: List[float],
    proximity_threshold: float = 0.005  # 0.5% de distancia
) -> Dict[str, any]:
    """
    Filtro 3: Proximidad a Bloques de Órdenes (Resistencias).
    
    Busca:
    - Precio a menos de 0.5% de una resistencia histórica importante
    
    Returns:
        Dict con 'passed' (bool) y detalles
    """
    if not resistances:
        return {"passed": False, "reason": "No hay resistencias detectadas"}

    nearest_resistance = None
    min_distance = float('inf')

    for res in resistances:
        distance = abs(current_close - res) / res if res != 0 else float('inf')
        if distance < min_distance:
            min_distance = distance
            nearest_resistance = res

    near_resistance = min_distance <= proximity_threshold

    return {
        "passed": near_resistance,
        "nearest_resistance": nearest_resistance,
        "distance_pct": min_distance * 100,
        "all_resistances": resistances
    }


def analyze_symbol(
    symbol: str,
    klines: List[List[any]]
) -> Dict[str, any]:
    """
    Analiza un símbolo con los 3 filtros del escáner.
    
    klines: Lista de velas en formato [timestamp, open, high, low, close, volume, ...]
    
    Returns:
        Dict completo de análisis
    """
    if len(klines) < 60:
        return {"symbol": symbol, "passed": False, "reason": "Velas insuficientes (<60)"}

    # Extraer datos de las velas
    opens = [float(k[1]) for k in klines]
    highs = [float(k[2]) for k in klines]
    lows = [float(k[3]) for k in klines]
    closes = [float(k[4]) for k in klines]
    volumes = [float(k[5]) for k in klines]

    # Calcular indicadores
    bb = calculate_bollinger_bands(closes, period=20)
    vol_sma = calculate_volume_sma(volumes, period=20)
    resistances = find_recent_resistances(highs, lookback=60)

    # Aplicar filtros
    filter1 = filter_1_bollinger_squeeze(
        closes=closes,
        bandwidth_history=bb["bandwidth"],
        upper_band=bb["upper_band"]
    )

    filter2 = filter_2_volume_anomaly(
        volumes=volumes,
        closes=closes,
        volume_sma=vol_sma
    )

    filter3 = filter_3_proximity_to_resistance(
        current_close=closes[-1],
        resistances=resistances
    )

    # Calcular score (0-3)
    score = sum([
        1 if filter1["passed"] else 0,
        1 if filter2["passed"] else 0,
        1 if filter3["passed"] else 0
    ])

    return {
        "symbol": symbol,
        "score": score,
        "passed_all_filters": score >= 2,
        "current_price": closes[-1],
        "filter_1": filter1,
        "filter_2": filter2,
        "filter_3": filter3,
        "bollinger_bands": {
            "middle": bb["middle_band"][-1],
            "upper": bb["upper_band"][-1],
            "lower": bb["lower_band"][-1],
            "bandwidth": bb["bandwidth"][-1]
        },
        "volume_sma_20": vol_sma[-1],
        "resistances": resistances
    }
