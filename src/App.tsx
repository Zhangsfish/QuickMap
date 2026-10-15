import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode, SVGProps } from 'react';
import { geoArea, geoBounds, geoGraticule10, geoNaturalEarth1, geoPath } from 'd3-geo';
import type { Geometry } from 'geojson';
import { countries, findPlaces, getCountryCities } from './data/mapData';
import type { CountryRecord, PlaceMatch } from './shared/types';
import type { MapCommand, MapOverlay } from './shared/protocol';

type View = { x: number; y: number; k: number };
type IconName = 'search' | 'close' | 'clipboard' | 'plus' | 'minus' | 'globe' | 'pin' | 'arrow' | 'layers' | 'expand';
function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    search: <><circle cx="10.8" cy="10.8" r="6.3"/><path d="m16 16 4.5 4.5"/></>,
    close: <path d="m6 6 12 12M18 6 6 18"/>,
    clipboard: <><rect x="6" y="5" width="13" height="16" rx="2"/><rect x="9" y="3" width="7" height="4" rx="1"/><path d="M10 12h5m-5 4h5"/></>,
    plus: <path d="M12 5v14M5 12h14"/>, minus: <path d="M5 12h14"/>,
    globe: <><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/></>,
    pin: <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2.2"/></>,
    arrow: <path d="m9 5 7 7-7 7"/>,
    layers: <><path d="m12 3 10 6-10 6L2 9l10-6Z"/><path d="m2 13 10 6 10-6M2 17l10 6 10-6"/></>,
    expand: <><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name]}</svg>;
}

const INITIAL_VIEW: View = { x: 0, y: 0, k: 1 };
const geometryLabels = { Point: '坐标点', MultiPoint: '坐标点组', LineString: '路线', MultiLineString: '路线组', Polygon: '区域', MultiPolygon: '区域组' };
// d3 uses spherical clockwise exterior rings. Accept ordinary GeoJSON winding
// from local tools too, so a small highlighted region never fills the globe.
function displayGeometry(geometry: MapOverlay['geometry']): MapOverlay['geometry'] {
  const orientPolygon = (coordinates: number[][][]) => coordinates.map((ring, index) => {
    const isLarge = geoArea({ type: 'Polygon', coordinates: [ring] }) > Math.PI * 2;
    // Exterior and hole rings must have opposite spherical winding.
    return isLarge === (index === 0) ? [...ring].reverse() : ring;
  });
  if (geometry.type === 'Polygon') return { ...geometry, coordinates: orientPolygon(geometry.coordinates) as [number, number][][] };
  if (geometry.type === 'MultiPolygon') return { ...geometry, coordinates: geometry.coordinates.map(orientPolygon) as [number, number][][][] };
  return geometry;
}
const coordinate = (lon: number, lat: number) => `${Math.abs(lat).toFixed(2)}° ${lat >= 0 ? 'N' : 'S'}  ·  ${Math.abs(lon).toFixed(2)}° ${lon >= 0 ? 'E' : 'W'}`;
const countryByCode = new Map(countries.map((country) => [country.code, country]));
const DEMO_OVERLAY: MapOverlay = {
  id: 'hormuz-demo', label: '霍尔木兹海峡 · Strait of Hormuz',
  description: '连接波斯湾与阿曼湾的海上通道，位于伊朗与阿曼之间。此区域是临时 GeoJSON 标注，可由本地 AI 创建、更新或移除。',
  source: 'Quick Map · 示例区域（示意范围）', color: '#f4b968',
  geometry: { type: 'Polygon', coordinates: [[[55.8, 26.1], [56.35, 25.85], [56.85, 26.25], [56.65, 26.8], [56.05, 26.75], [55.8, 26.1]]] },
};

export default function App() {
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [rotation, setRotation] = useState(0);
  const [view, setView] = useState<View>(INITIAL_VIEW);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [hover, setHover] = useState<{ country: CountryRecord; x: number; y: number } | null>(null);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [resultIndex, setResultIndex] = useState(0);
  const [overlays, setOverlays] = useState<MapOverlay[]>([]);
  const [activeOverlay, setActiveOverlay] = useState<string | null>(null);
  const [highlightCity, setHighlightCity] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [hidden, setHidden] = useState(false);
  const [dragging, setDragging] = useState(false);
  const focusTarget = useRef<{ geometry: Geometry } | { lon: number; lat: number; scale: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const drag = useRef<{ x: number; y: number; origin: View; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const commandHandler = useRef<(command: MapCommand) => void>(() => {});
  const selected = selectedCode ? countryByCode.get(selectedCode) : undefined;
  const active = overlays.find((overlay) => overlay.id === activeOverlay);
  const neighbors = useMemo(() => new Set(selected?.neighbors ?? []), [selected]);
  const selectedCities = useMemo(() => {
    if (!selected) return [];
    const all = getCountryCities(selected.code);
    const visible = all.slice(0, 14);
    const highlighted = all.find((city) => city.id === highlightCity);
    return highlighted && !visible.some((city) => city.id === highlighted.id) ? [...visible.slice(0, 13), highlighted] : visible;
  }, [selected, highlightCity]);
  const matches = useMemo(() => query.trim() ? findPlaces(query.trim()).slice(0, 8) : [], [query]);

  const projection = useMemo(() => geoNaturalEarth1().fitExtent(
    [[size.width < 850 ? 20 : 66, 105], [size.width - (size.width < 850 ? 20 : 66), size.height - 100]],
    { type: 'Sphere' },
  ).rotate([rotation, 0]), [size, rotation]);
  const path = useMemo(() => geoPath(projection), [projection]);
  const countryPaths = useMemo(() => countries.map((country) => ({ country, d: path(country.geometry) ?? '' })), [path]);
  const graticule = useMemo(() => path(geoGraticule10()) ?? '', [path]);
  const visibleCityLabels = useMemo(() => {
    const occupied: { x: number; y: number; width: number }[] = [];
    const visible = new Set<string>();
    const ordered = [...selectedCities].sort((a, b) => Number(b.id === highlightCity) - Number(a.id === highlightCity) || Number(Boolean(b.isCapital)) - Number(Boolean(a.isCapital)));
    for (const city of ordered) {
      const point = projection([city.lon, city.lat]);
      if (!point) continue;
      const box = { x: point[0] * view.k + view.x + 11, y: point[1] * view.k + view.y, width: (city.nameZh?.length ?? city.nameEn.length * 0.6) * 11 + 12 };
      if (occupied.some((other) => Math.abs(other.y - box.y) < 18 && box.x < other.x + other.width && box.x + box.width > other.x)) continue;
      occupied.push(box);
      visible.add(city.id);
    }
    return visible;
  }, [selectedCities, highlightCity, projection, view]);

  const announce = useCallback((message: string) => setNotice(message), []);
  const focusPoint = useCallback((lon: number, lat: number, scale = 5) => {
    // Start each focus with a fresh seam, so a previous Pacific focus cannot
    // split a newly selected place at the map edge.
    const nextRotation = Math.abs(lon) > 150 ? -lon : 0;
    const point = geoNaturalEarth1().scale(projection.scale()).translate(projection.translate()).rotate([nextRotation, 0])([lon, lat]);
    if (!point) return;
    focusTarget.current = { lon, lat, scale };
    setRotation(nextRotation);
    const centerX = size.width > 950 ? size.width * 0.44 : size.width * 0.5;
    setView({ x: centerX - point[0] * scale, y: size.height * 0.5 - point[1] * scale, k: scale });
    setHidden(false);
  }, [projection, size]);

  const focusGeometry = useCallback((geometry: Geometry) => {
    const [[west], [east]] = geoBounds(geometry);
    const centerLon = west > east ? ((west + east + 360) / 2) : (west + east) / 2;
    const nextRotation = west > east ? -centerLon : 0;
    const focusPath = geoPath(geoNaturalEarth1().scale(projection.scale()).translate(projection.translate()).rotate([nextRotation, 0]));
    const [[x0, y0], [x1, y1]] = focusPath.bounds(geometry);
    if (![x0, y0, x1, y1].every(Number.isFinite)) return;
    focusTarget.current = { geometry };
    setRotation(nextRotation);
    const availableWidth = size.width > 950 ? size.width - 470 : size.width - 80;
    const scale = Math.max(1.35, Math.min(30, Math.min(availableWidth / Math.max(12, x1 - x0), Math.max(100, size.height - 260) / Math.max(12, y1 - y0)) * 0.78));
    const centerX = size.width > 950 ? (size.width - 330) / 2 : size.width / 2;
    setView({ x: centerX - (x0 + x1) / 2 * scale, y: size.height / 2 - (y0 + y1) / 2 * scale, k: scale });
    setHidden(false);
  }, [projection, size]);

  // Electron can resize after delivering a command while showing its window.
  // Refit the current target using the new projection instead of losing focus.
  const refocus = useRef(() => {});
  refocus.current = () => {
    const target = focusTarget.current;
    if (!target) return;
    if ('geometry' in target) focusGeometry(target.geometry);
    else focusPoint(target.lon, target.lat, target.scale);
  };
  useLayoutEffect(() => { refocus.current(); }, [size]);

  const resetView = useCallback(() => { focusTarget.current = null; setRotation(0); setView(INITIAL_VIEW); }, []);

  const selectCountry = useCallback((country: CountryRecord, focus = true) => {
    setSelectedCode(country.code);
    setActiveOverlay(null);
    setHighlightCity(null);
    setHover(null);
    setSearchOpen(false);
    if (focus) focusGeometry(country.geometry);
  }, [focusGeometry]);

  const choosePlace = useCallback((place: PlaceMatch) => {
    const country = place.countryCode ? countryByCode.get(place.countryCode) : countries.find((item) => item.id === place.id);
    if (country) selectCountry(country, place.kind === 'country');
    if (place.kind === 'city') {
      setHighlightCity(place.id);
      focusPoint(place.lon, place.lat, 7);
    }
    setQuery(place.label);
    setSearchOpen(false);
    setHidden(false);
    searchRef.current?.blur();
  }, [focusPoint, selectCountry]);

  const runSearch = useCallback((text: string) => {
    const clean = text.trim().slice(0, 200);
    setQuery(clean);
    setResultIndex(0);
    setHidden(false);
    const results = findPlaces(clean);
    if (results[0]) choosePlace(results[0]);
    else { setSearchOpen(true); announce(`未找到“${clean}”，可让本地 AI 发送坐标或 GeoJSON 标注。`); }
  }, [choosePlace, announce]);

  const addOverlay = useCallback((overlay: MapOverlay) => {
    if (overlay.expiresAt && Date.parse(overlay.expiresAt) <= Date.now()) return;
    overlay = { ...overlay, geometry: displayGeometry(overlay.geometry) };
    setOverlays((previous) => [...previous.filter((item) => item.id !== overlay.id), overlay]);
    setActiveOverlay(overlay.id);
    setSelectedCode(null);
    setHighlightCity(null);
    setQuery('');
    setSearchOpen(false);
    setHover(null);
    if (overlay.geometry.type === 'Point') focusPoint(...overlay.geometry.coordinates, 7);
    else focusGeometry(overlay.geometry);
  }, [focusGeometry, focusPoint]);

  commandHandler.current = (command) => {
    setHidden(false);
    switch (command.type) {
      case 'show_place':
        addOverlay({ id: `place-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, label: command.label, description: command.description, source: command.source,
          color: '#f4b968', geometry: { type: 'Point', coordinates: [command.lon, command.lat] } });
        announce(`已定位：${command.label}`);
        break;
      case 'search': runSearch(command.query); break;
      case 'upsert_overlay': addOverlay(command.overlay); announce(`已更新标注：${command.overlay.label}`); break;
      case 'remove_overlay': setOverlays((previous) => previous.filter((item) => item.id !== command.id)); setActiveOverlay((previous) => previous === command.id ? null : previous); break;
      case 'clear_overlays': setOverlays([]); setActiveOverlay(null); announce('已清除全部临时标注'); break;
    }
  };

  useEffect(() => {
    const resize = () => { setSize({ width: window.innerWidth, height: window.innerHeight }); };
    window.addEventListener('resize', resize);
    const unsubscribe = window.quickMap?.onCommand((command) => commandHandler.current(command));
    window.quickMap?.ready();
    return () => { window.removeEventListener('resize', resize); unsubscribe?.(); };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setOverlays((previous) => {
      const next = previous.filter((overlay) => !overlay.expiresAt || Date.parse(overlay.expiresAt) > Date.now());
      return next.length === previous.length ? previous : next;
    }), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 4500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const hide = useCallback(() => {
    if (window.quickMap) void window.quickMap.hide();
    else setHidden(true);
  }, []);

  const readClipboard = useCallback(async () => {
    try {
      const selection = window.getSelection()?.toString().trim();
      const text = selection || (window.quickMap ? await window.quickMap.getClipboardText() : await navigator.clipboard.readText());
      if (text.trim()) runSearch(text);
      else announce('剪贴板为空。复制一个国家或城市名称后再试。');
    } catch { announce('无法读取剪贴板，请将地名粘贴到搜索框。'); searchRef.current?.focus(); }
  }, [announce, runSearch]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const editing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
      if (event.key === 'Escape') { event.preventDefault(); hide(); }
      if (event.key === '/' && !editing) { event.preventDefault(); setSearchOpen(true); searchRef.current?.focus(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v' && !editing) { event.preventDefault(); void readClipboard(); }
      if (event.key === 'Home' && !editing) resetView();
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [hide, readClipboard, resetView]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      setHover(null);
      const rect = svg.getBoundingClientRect();
      const x = event.clientX - rect.left, y = event.clientY - rect.top;
      setView((previous) => {
        const k = Math.max(0.8, Math.min(40, previous.k * Math.exp(-event.deltaY * 0.0015)));
        return { k, x: x - (x - previous.x) * k / previous.k, y: y - (y - previous.y) * k / previous.k };
      });
    };
    svg.addEventListener('wheel', wheel, { passive: false });
    return () => svg.removeEventListener('wheel', wheel);
  }, [hidden]);

  const zoom = (factor: number) => setView((previous) => {
    const k = Math.max(0.8, Math.min(40, previous.k * factor));
    return { k, x: size.width / 2 - (size.width / 2 - previous.x) * k / previous.k, y: size.height / 2 - (size.height / 2 - previous.y) * k / previous.k };
  });
  const pointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    drag.current = { x: event.clientX, y: event.clientY, origin: view, moved: false };
    suppressClick.current = false;
  };
  const pointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!drag.current) return;
    const dx = event.clientX - drag.current.x, dy = event.clientY - drag.current.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) {
      drag.current.moved = true;
      suppressClick.current = true;
      setDragging(true);
      setHover(null);
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.setPointerCapture(event.pointerId);
      setView({ ...drag.current.origin, x: drag.current.origin.x + dx, y: drag.current.origin.y + dy });
    }
  };
  const pointerUp = () => { drag.current = null; setDragging(false); };
  const pointerLeave = () => { if (!drag.current?.moved) drag.current = null; setHover(null); };

  if (hidden) return <div className="hidden-screen"><div className="brand-mark"><Icon name="globe"/></div><h1>地图已收起</h1><p>桌面应用中，使用全局快捷键随时唤出。</p><button className="primary-button" onClick={() => setHidden(false)}>返回地图 <Icon name="arrow"/></button></div>;

  return <main className="app-shell">
    <svg ref={svgRef} className={`world-map ${dragging ? 'is-dragging' : ''}`} width={size.width} height={size.height} aria-label="交互式离线世界地图，可拖动平移、滚轮缩放，点击国家查看邻国和主要城市" role="img"
      onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} onPointerLeave={pointerLeave}
      onClick={(event) => { if ((event.target === event.currentTarget || (event.target instanceof Element && event.target.classList.contains('ocean-border'))) && !suppressClick.current) { setSelectedCode(null); setActiveOverlay(null); setSearchOpen(false); } }}>
      <defs>
        <radialGradient id="ocean-glow"><stop offset="0%" stopColor="#183941" stopOpacity=".55"/><stop offset="100%" stopColor="#0c1922" stopOpacity="0"/></radialGradient>
        <pattern id="map-dots" width="28" height="28" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".65" fill="#73929b" opacity=".12"/></pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#map-dots)" pointerEvents="none"/>
      <ellipse cx={size.width * 0.48} cy={size.height * 0.5} rx={size.width * 0.55} ry={size.height * 0.55} fill="url(#ocean-glow)" pointerEvents="none"/>
      <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
        <path d={path({ type: 'Sphere' }) ?? ''} className="ocean-border" vectorEffect="non-scaling-stroke"/>
        <path d={graticule} className="graticule" vectorEffect="non-scaling-stroke"/>
        {countryPaths.map(({ country, d }) => <path key={country.id} d={d}
          className={`country ${selectedCode === country.code ? 'selected' : ''} ${neighbors.has(country.code) ? 'neighbor' : ''}`}
          vectorEffect="non-scaling-stroke"
          onPointerEnter={(event) => { if (!drag.current?.moved) setHover({ country, x: event.clientX, y: event.clientY }); }}
          onPointerMove={(event) => { if (!drag.current?.moved) setHover({ country, x: event.clientX, y: event.clientY }); }}
          onPointerLeave={() => setHover(null)}
          onClick={(event) => { event.stopPropagation(); if (!suppressClick.current) selectCountry(country); }}>
          <title>{country.nameZh} · {country.nameEn} · 首都 {country.capitalZh || country.capitalEn || '暂无资料'}</title>
        </path>)}
        {view.k > 2.2 && countries.map((country) => {
          const point = projection([country.lon, country.lat]);
          if (!point || point[0] * view.k + view.x < 0 || point[0] * view.k + view.x > size.width || point[1] * view.k + view.y < 80 || point[1] * view.k + view.y > size.height - 60) return null;
          return <g key={`label-${country.id}`} transform={`translate(${point[0]},${point[1]}) scale(${1 / view.k})`} className="country-label"><text textAnchor="middle">{country.nameZh}</text></g>;
        })}
        {selectedCities.map((city) => {
          const point = projection([city.lon, city.lat]);
          if (!point) return null;
          return <g key={city.id} transform={`translate(${point[0]},${point[1]}) scale(${1 / view.k})`} className={`city-marker ${city.isCapital ? 'capital' : ''} ${highlightCity === city.id ? 'highlight' : ''}`}
            onClick={(event) => { event.stopPropagation(); if (!suppressClick.current) { setHighlightCity(city.id); focusPoint(city.lon, city.lat, Math.max(7, view.k)); } }}>
            <circle className="city-halo" r={city.isCapital ? 9 : 7}/><circle r={city.isCapital ? 4 : 3}/>
            {visibleCityLabels.has(city.id) && <text x="11" y="4">{city.nameZh || city.nameEn}{city.isCapital ? ' ★' : ''}</text>}
            <title>{city.nameZh || city.nameEn} · {city.nameEn}</title>
          </g>;
        })}
        {overlays.map((overlay) => {
          const color = overlay.color || '#f4b968';
          const center = path.centroid(overlay.geometry);
          return <g key={overlay.id} className={`map-overlay ${activeOverlay === overlay.id ? 'active' : ''}`} style={{ '--overlay-color': color } as CSSProperties}
            onClick={(event) => { event.stopPropagation(); if (!suppressClick.current) { setActiveOverlay(overlay.id); setSelectedCode(null); } }}>
            <title>{overlay.label}{overlay.description ? ` · ${overlay.description}` : ''}</title>
            {overlay.geometry.type === 'Point' || overlay.geometry.type === 'MultiPoint' ? (overlay.geometry.type === 'Point' ? [overlay.geometry.coordinates] : overlay.geometry.coordinates).map((position, index) => {
              const point = projection(position);
              return point ? <g key={index} transform={`translate(${point[0]},${point[1]}) scale(${1 / view.k})`}><circle className="overlay-halo" r="17"/><circle className="overlay-point" r="6"/></g> : null;
            }) : <path className={`overlay-geometry ${overlay.geometry.type === 'LineString' || overlay.geometry.type === 'MultiLineString' ? 'line' : ''}`} d={path(overlay.geometry) ?? ''} vectorEffect="non-scaling-stroke"/>}
            {center.every(Number.isFinite) && <g transform={`translate(${center[0]},${center[1]}) scale(${1 / view.k})`}><text className="overlay-label" y="-23" textAnchor="middle">{overlay.label.split(' · ')[0]}</text></g>}
          </g>;
        })}
      </g>
    </svg>

    <header className="topbar">
      <a className="brand" href="#" onClick={(event) => { event.preventDefault(); resetView(); setSelectedCode(null); setActiveOverlay(null); }} aria-label="Quick Map 返回世界视图"><span className="brand-mark"><Icon name="globe"/></span><span>Quick<span className="brand-light">Map</span><small>世界，随时在手边</small></span></a>
      <div className="topbar-right"><span className="offline-pill"><i/>离线地图 <span>OFFLINE</span></span><button className="hide-button" onClick={hide} title="收起地图 (Esc)">收起 <kbd>esc</kbd></button></div>
    </header>

    <section className="search-area" aria-label="地名搜索">
      <div className={`search-box ${searchOpen ? 'focused' : ''}`}><Icon name="search"/><input ref={searchRef} value={query} placeholder="搜索国家、城市 / Search places" aria-label="搜索国家或城市" role="combobox" aria-expanded={searchOpen} aria-controls="search-results" aria-autocomplete="list" aria-activedescendant={searchOpen && matches[resultIndex] ? `result-${matches[resultIndex].id}` : undefined}
        onFocus={() => setSearchOpen(true)} onChange={(event) => { setQuery(event.target.value); setSearchOpen(true); setResultIndex(0); }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') { event.preventDefault(); setResultIndex((previous) => Math.min(previous + 1, matches.length - 1)); }
          if (event.key === 'ArrowUp') { event.preventDefault(); setResultIndex((previous) => Math.max(0, previous - 1)); }
          if (event.key === 'Enter') { event.preventDefault(); if (matches[resultIndex]) choosePlace(matches[resultIndex]); else if (query.trim()) runSearch(query); }
        }}/>{query ? <button className="icon-button small" aria-label="清空搜索" onClick={() => { setQuery(''); searchRef.current?.focus(); }}><Icon name="close"/></button> : <kbd>/</kbd>}
        <span className="search-divider"/><button className="icon-button" aria-label="搜索选中文字或剪贴板" title="搜索选中文字或剪贴板 (Ctrl+V)" onClick={() => void readClipboard()}><Icon name="clipboard"/></button>
      </div>
      {searchOpen && <div className="search-results" id="search-results" role="listbox" aria-label="搜索结果">
        {query.trim() ? matches.length ? matches.map((match, index) => <button key={match.id} id={`result-${match.id}`} role="option" aria-selected={index === resultIndex} className={`search-result ${index === resultIndex ? 'active' : ''}`} onMouseEnter={() => setResultIndex(index)} onClick={() => choosePlace(match)}><span className="result-icon"><Icon name={match.kind === 'country' ? 'globe' : 'pin'}/></span><span>{match.label}<small>{match.kind === 'country' ? '国家 / 地区' : '城市'}{match.countryCode ? ` · ${countryByCode.get(match.countryCode)?.nameZh || match.countryCode}` : ''}</small></span><Icon name="arrow"/></button>) : <div className="search-empty"><Icon name="search"/><p>没有找到这个地名</p><span>试试中文、英文或国家代码；海峡等地点可由本地 AI 标注。</span></div> : <div className="search-suggestions"><span className="eyebrow">从一个地方开始</span><div>{['中国', '日本', '法国', 'Egypt'].map((text) => <button key={text} onClick={() => runSearch(text)}>{text}<Icon name="arrow"/></button>)}</div><p><Icon name="clipboard"/>复制地名后按 Ctrl + V，直接跳转</p></div>}
      </div>}
      {!searchOpen && !selected && !active && <div className="map-intro"><span className="eyebrow">YOUR WORLD, AT A GLANCE</span><h1>每一个地名，<br/>都有了位置。</h1><p>悬停认识国家，点击探索邻国与城市。<br/>从一段文字，抵达世界的任何角落。</p><div className="intro-rule"/><span className="intro-caption">{countries.length} 个国家与地区 · 全程离线</span></div>}
    </section>

    {(selected || active) && <aside className="detail-panel" aria-label={selected ? '国家详情' : '临时标注详情'}>
      <div className="panel-topline"><span className="eyebrow">{selected ? 'EXPLORE A COUNTRY' : 'DYNAMIC MAP LAYER'}</span><button className="icon-button small" aria-label="关闭详情" onClick={() => { setSelectedCode(null); setActiveOverlay(null); }}><Icon name="close"/></button></div>
      {selected ? <>
        <div className="country-code">{selected.code}</div><h2>{selected.nameZh}</h2><p className="english-name">{selected.nameEn}</p>
        <div className="capital-card"><span className="capital-star">★</span><div><span className="field-label">首都 / CAPITAL</span><strong>{selected.capitalZh || selected.capitalEn || '暂无资料'}</strong>{selected.capitalZh && selected.capitalEn && <small>{selected.capitalEn}</small>}</div></div>
        <div className="section-heading"><h3>相邻国家</h3><span>{neighbors.size.toString().padStart(2, '0')}</span></div>
        <div className="neighbor-list">{selected.neighbors.length ? selected.neighbors.map((code) => { const neighbor = countryByCode.get(code); return neighbor ? <button key={code} onClick={() => selectCountry(neighbor)}><span className="neighbor-dot"/>{neighbor.nameZh}<Icon name="arrow"/></button> : null; }) : <p className="muted-note">没有陆地接壤的国家</p>}</div>
        <div className="section-heading"><h3>主要城市</h3><span>{selectedCities.length.toString().padStart(2, '0')}</span></div>
        <div className="city-list">{selectedCities.length ? selectedCities.map((city) => <button key={city.id} className={highlightCity === city.id ? 'active' : ''} onClick={() => { setHighlightCity(city.id); focusPoint(city.lon, city.lat, 8); }}><span className={`city-list-dot ${city.isCapital ? 'is-capital' : ''}`}/><span>{city.nameZh || city.nameEn}<small>{city.nameEn}</small></span>{city.isCapital ? <span className="capital-tag">首都</span> : <Icon name="arrow"/>}</button>) : <p className="muted-note">当前离线数据暂无城市记录</p>}</div>
        <div className="panel-coordinate"><Icon name="pin"/>{coordinate(selected.lon, selected.lat)}</div>
      </> : active ? <>
        <div className="overlay-badge"><Icon name="layers"/>临时标注</div><h2 className="overlay-title">{active.label}</h2><p className="overlay-description">{active.description || '由本地 AI 或工具添加的地图标注。'}</p>
        <div className="overlay-metadata"><span>几何类型</span><strong>{geometryLabels[active.geometry.type]}</strong>{active.source && <><span>来源</span><strong>{active.source}</strong></>}{active.expiresAt && <><span>有效期至</span><strong>{new Date(active.expiresAt).toLocaleString('zh-CN')}</strong></>}</div>
        <button className="secondary-button" onClick={() => { if (active.geometry.type === 'Point') focusPoint(...active.geometry.coordinates, 7); else focusGeometry(active.geometry); }}><Icon name="expand"/>定位标注</button>
        <button className="text-button danger" onClick={() => { setOverlays((previous) => previous.filter((overlay) => overlay.id !== active.id)); setActiveOverlay(null); }}>移除此标注</button>
      </> : null}
    </aside>}

    <div className="bottom-left">
      <div className="ai-card"><span className="ai-symbol">✦</span><div><strong>让 AI 带你找到它</strong><p>坐标、海峡、路线，直接标在地图上。</p><button onClick={() => addOverlay(DEMO_OVERLAY)}>试试：霍尔木兹海峡 <Icon name="arrow"/></button></div>{overlays.length > 0 && <span className="layer-count" title={`${overlays.length} 个临时标注`}>{overlays.length}</span>}</div>
      {overlays.length > 0 && <div className="layer-strip" aria-label="临时图层">{overlays.map((overlay) => <button className={activeOverlay === overlay.id ? 'active' : ''} key={overlay.id} onClick={() => { setActiveOverlay(overlay.id); setSelectedCode(null); if (overlay.geometry.type === 'Point') focusPoint(...overlay.geometry.coordinates, 7); else focusGeometry(overlay.geometry); }}><i style={{ background: overlay.color || '#f4b968' }}/>{overlay.label.split(' · ')[0]}</button>)}<button className="clear-layers" onClick={() => { setOverlays([]); setActiveOverlay(null); }} title="清除全部临时标注"><Icon name="close"/></button></div>}
    </div>

    <nav className="map-controls" aria-label="地图视图控制"><button aria-label="放大" title="放大" onClick={() => zoom(1.5)}><Icon name="plus"/></button><button aria-label="缩小" title="缩小" onClick={() => zoom(1 / 1.5)}><Icon name="minus"/></button><span/><button aria-label="返回世界视图" title="世界视图 (Home)" onClick={resetView}><Icon name="globe"/></button></nav>
    <footer className="map-footer"><span><i/>LOCAL EXPLORER <b>01</b></span><div className="map-legend"><span><i className="selected-key"/>当前国家</span><span><i className="neighbor-key"/>相邻国家</span><span><i className="city-key"/>主要城市</span></div><span className="footer-hint">拖动平移<span>·</span>滚轮缩放<span>·</span>{view.k.toFixed(1)}×<span className="data-attribution">地图数据 © Natural Earth</span></span></footer>
    {hover && !dragging && <div className="country-tooltip" style={{ left: Math.min(size.width - 255, Math.max(12, hover.x + 17)), top: Math.max(90, Math.min(size.height - 130, hover.y + 17)) }}><span className="tooltip-code">{hover.country.code}</span><strong>{hover.country.nameZh}</strong><span className="tooltip-english">{hover.country.nameEn}</span><div><span>首都</span>{hover.country.capitalZh || hover.country.capitalEn || '暂无资料'}</div><small>点击探索邻国与主要城市 <Icon name="arrow"/></small></div>}
    <div className={`toast ${notice ? 'visible' : ''}`} role="status" aria-live="polite">{notice}</div>
  </main>;
}
