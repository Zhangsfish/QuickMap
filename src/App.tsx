import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode, SVGProps } from 'react';
import { geoArea, geoBounds, geoGraticule10, geoNaturalEarth1, geoPath } from 'd3-geo';
import type { Geometry } from 'geojson';
import { countries, findPlaces, findRegion, getCountryCities } from './data/mapData';
import type { CountryRecord, PlaceMatch } from './shared/types';
import type { MapCommand, MapOverlay } from './shared/protocol';
import { HORMUZ_STORY, storyLayerById, storyStepById } from './story/hormuz';
import type { StoryCamera, StoryLayer, StoryStep } from './story/hormuz';
import type { MapAskEvent } from './bridge';

type View = { x: number; y: number; k: number };
type FocusTarget = { geometry: Geometry } | { lon: number; lat: number; scale: number } | { storyCamera: StoryCamera };
type StoryEntry = { view: View; rotation: number; selectedCode: string | null; highlightCity: string | null; activeOverlay: string | null; query: string; focusTarget: FocusTarget | null };
type ChatMessage = { id: string; role: 'user' | 'assistant'; text: string; stepIds?: string[]; sourceIds?: string[]; status?: 'streaming' | 'done' | 'cancelled' | 'error' };
const CHAT_STORAGE_KEY = `quickmap:map-chat:story-v${HORMUZ_STORY.version}`;
function readStoredChatMessages(): ChatMessage[] {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(CHAT_STORAGE_KEY) ?? '[]');
    if (!Array.isArray(stored)) return [];
    const restored: ChatMessage[] = [];
    for (const pair of stored.slice(-12)) {
      if (!Array.isArray(pair) || pair.length !== 2) continue;
      const [user, assistant] = pair as Array<Record<string, unknown>>;
      if (!user || user.role !== 'user' || typeof user.text !== 'string' || !user.text.trim() || user.text.length > 2000) continue;
      if (!assistant || assistant.role !== 'assistant' || typeof assistant.text !== 'string' || !assistant.text.trim() || assistant.text.length > 12000) continue;
      const stepIds = Array.isArray(assistant.stepIds) ? assistant.stepIds.filter((id): id is StoryStep['id'] => typeof id === 'string' && storyStepById.has(id as StoryStep['id'])).slice(0, 5) : [];
      const sourceIds = Array.isArray(assistant.sourceIds) ? assistant.sourceIds.filter((id): id is string => typeof id === 'string' && Boolean(HORMUZ_STORY.sources[id])).slice(0, 5) : [];
      const index = restored.length / 2;
      restored.push({ id: `restored-user-${index}`, role: 'user', text: user.text }, { id: `restored-assistant-${index}`, role: 'assistant', text: assistant.text, stepIds, sourceIds, status: 'done' });
    }
    return restored;
  } catch { return []; }
}
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
const MAX_ZOOM = 800;
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
export default function App() {
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [rotation, setRotation] = useState(0);
  const [view, setView] = useState<View>(INITIAL_VIEW);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [selectionPulse, setSelectionPulse] = useState(0);
  const [hover, setHover] = useState<{ country: CountryRecord; x: number; y: number } | null>(null);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [resultIndex, setResultIndex] = useState(0);
  const [overlays, setOverlays] = useState<MapOverlay[]>([]);
  const [activeOverlay, setActiveOverlay] = useState<string | null>(null);
  const [highlightCity, setHighlightCity] = useState<string | null>(null);
  const [storyOpen, setStoryOpen] = useState(false);
  const [storyStepId, setStoryStepId] = useState<StoryStep['id']>('hormuz-1');
  const [activeStoryParagraphId, setActiveStoryParagraphId] = useState<string | null>(null);
  const [activeStoryLayerIds, setActiveStoryLayerIds] = useState<string[]>([]);
  const [sideMode, setSideMode] = useState<'story' | 'chat' | null>(null);
  const [askDraft, setAskDraft] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(readStoredChatMessages);
  const [askBusy, setAskBusy] = useState(false);
  const [chatError, setChatError] = useState('');
  const [notice, setNotice] = useState('');
  const [hidden, setHidden] = useState(false);
  const [dragging, setDragging] = useState(false);
  const focusTarget = useRef<FocusTarget | null>(null);
  const storyEntry = useRef<StoryEntry | null>(null);
  const askRequestId = useRef<string | null>(null);
  const assistantMessageId = useRef<string | null>(null);
  const askGeneration = useRef(0);
  const manualMapMovementSinceAsk = useRef(false);
  const bufferedMapEvents = useRef<Map<string, MapAskEvent[]>>(new Map());
  const svgRef = useRef<SVGSVGElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const drag = useRef<{ x: number; y: number; origin: View; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const commandHandler = useRef<(command: MapCommand) => void>(() => {});
  const mapEventHandler = useRef<(event: MapAskEvent) => void>(() => {});
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
  const highlightedCity = selectedCities.find((city) => city.id === highlightCity);
  const storyStep = storyStepById.get(storyStepId) ?? HORMUZ_STORY.steps[0];
  const visibleStoryLayers = storyOpen ? storyStep.layerIds.map((id) => storyLayerById.get(id)).filter((layer): layer is StoryLayer => Boolean(layer)) : [];
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
    const scale = Math.max(1.35, Math.min(MAX_ZOOM, Math.min(availableWidth / Math.max(0.1, x1 - x0), Math.max(100, size.height - 260) / Math.max(0.1, y1 - y0)) * 0.78));
    const centerX = size.width > 950 ? (size.width - 330) / 2 : size.width / 2;
    setView({ x: centerX - (x0 + x1) / 2 * scale, y: size.height / 2 - (y0 + y1) / 2 * scale, k: scale });
    setHidden(false);
  }, [projection, size]);

  const focusStoryCamera = useCallback((camera: StoryCamera) => {
    const nextRotation = Math.abs(camera.lon) > 150 ? -camera.lon : 0;
    const point = geoNaturalEarth1().scale(projection.scale()).translate(projection.translate()).rotate([nextRotation, 0])([camera.lon, camera.lat]);
    if (!point) return;
    focusTarget.current = { storyCamera: camera };
    setRotation(nextRotation);
    const panelSpace = size.width > 1550 ? 475 : size.width > 760 ? 435 : 0;
    const centerX = (size.width - panelSpace) / 2;
    setView({ x: centerX - point[0] * camera.scale, y: size.height * 0.5 - point[1] * camera.scale, k: camera.scale });
    setHidden(false);
  }, [projection, size]);

  // Electron can resize after delivering a command while showing its window.
  // Refit the current target using the new projection instead of losing focus.
  const refocus = useRef(() => {});
  refocus.current = () => {
    const target = focusTarget.current;
    if (!target) return;
    if ('storyCamera' in target) focusStoryCamera(target.storyCamera);
    else if ('geometry' in target) focusGeometry(target.geometry);
    else focusPoint(target.lon, target.lat, target.scale);
  };
  useLayoutEffect(() => { refocus.current(); }, [size]);

  const resetView = useCallback(() => { focusTarget.current = null; setRotation(0); setView(INITIAL_VIEW); }, []);

  const selectCountry = useCallback((country: CountryRecord, focus = true) => {
    storyEntry.current = null;
    setStoryOpen(false);
    setSideMode(null);
    setSelectedCode(country.code);
    setSelectionPulse((previous) => previous + 1);
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
    // Personal annotations remain independent of the story and its saved entry view.
    if (storyEntry.current) return;
    setSideMode(null);
    setActiveOverlay(overlay.id);
    setSelectedCode(null);
    setHighlightCity(null);
    setQuery('');
    setSearchOpen(false);
    setHover(null);
    if (overlay.geometry.type === 'Point') focusPoint(...overlay.geometry.coordinates, 7);
    else focusGeometry(overlay.geometry);
  }, [focusGeometry, focusPoint]);

  const activateStoryStep = useCallback((stepId: StoryStep['id'], showStoryPanel = true) => {
    const step = storyStepById.get(stepId);
    if (!step) return;
    if (!storyEntry.current) storyEntry.current = { view, rotation, selectedCode, highlightCity, activeOverlay, query, focusTarget: focusTarget.current };
    setStoryOpen(true);
    setStoryStepId(stepId);
    setActiveStoryParagraphId(step.paragraphs[0]?.id ?? null);
    setActiveStoryLayerIds(step.paragraphs[0]?.layerIds ?? []);
    if (showStoryPanel) setSideMode('story');
    setSelectedCode(null);
    setHighlightCity(null);
    setActiveOverlay(null);
    setSearchOpen(false);
    setHover(null);
    focusStoryCamera(step.camera);
  }, [view, rotation, selectedCode, highlightCity, activeOverlay, query, focusStoryCamera]);

  const exitStory = useCallback(() => {
    const entry = storyEntry.current;
    storyEntry.current = null;
    setStoryOpen(false);
    setActiveStoryParagraphId(null);
    setActiveStoryLayerIds([]);
    setSideMode(null);
    if (!entry) return;
    focusTarget.current = entry.focusTarget;
    setView(entry.view);
    setRotation(entry.rotation);
    setSelectedCode(entry.selectedCode);
    setHighlightCity(entry.highlightCity);
    setActiveOverlay(entry.activeOverlay);
    setQuery(entry.query);
  }, []);

  const focusStoryLayerIds = useCallback((layerIds: string[]) => {
    const valid = layerIds.filter((id) => storyStep.layerIds.includes(id));
    setActiveStoryLayerIds(valid);
    if (valid.length !== 1) { focusStoryCamera(storyStep.camera); return; }
    const layer = storyLayerById.get(valid[0]);
    if (!layer) return;
    if (layer.geometry.type === 'Point') focusStoryCamera({ lon: layer.geometry.coordinates[0], lat: layer.geometry.coordinates[1], scale: Math.max(storyStep.camera.scale, 9) });
    else if (layer.geometry.type === 'MultiPoint') focusStoryCamera(storyStep.camera);
    else focusGeometry(layer.geometry);
  }, [storyStep, focusStoryCamera, focusGeometry]);

  const chooseStoryLayer = useCallback((layerId: string) => {
    const paragraph = storyStep.paragraphs.find((item) => item.layerIds.includes(layerId));
    setActiveStoryLayerIds([layerId]);
    setActiveStoryParagraphId(paragraph?.id ?? null);
    setSideMode('story');
    if (paragraph) window.requestAnimationFrame(() => document.getElementById(`story-paragraph-${paragraph.id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  }, [storyStep]);

  commandHandler.current = (command) => {
    setHidden(false);
    switch (command.type) {
      case 'show_place':
        addOverlay({ id: `place-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, label: command.label, description: command.description, source: command.source,
          color: '#f4b968', geometry: { type: 'Point', coordinates: [command.lon, command.lat] } });
        announce(`已定位：${command.label}`);
        break;
      case 'search': runSearch(command.query); break;
      case 'focus_region': {
        const region = findRegion(command.query);
        if (region) {
          selectCountry(region);
          setQuery(command.query);
          announce(`已强调地区：${region.nameZh}`);
        } else {
          setQuery(command.query);
          setSearchOpen(true);
          announce(`没有找到名称完全匹配的地区“${command.query}”。请使用国家或地区的完整名称或代码；城市可使用地名搜索。`);
        }
        break;
      }
      case 'upsert_overlay': addOverlay(command.overlay); announce(`已更新标注：${command.overlay.label}`); break;
      case 'remove_overlay': setOverlays((previous) => previous.filter((item) => item.id !== command.id)); setActiveOverlay((previous) => previous === command.id ? null : previous); break;
      case 'clear_overlays': setOverlays([]); setActiveOverlay(null); announce('已清除全部临时标注'); break;
      case 'set_story_step': activateStoryStep(command.stepId); announce(`已切换故事：${storyStepById.get(command.stepId)?.title ?? command.stepId}`); break;
    }
  };

  const openSource = async (sourceId: string) => {
    if (!HORMUZ_STORY.sources[sourceId]) return;
    try {
      if (!window.quickMap?.openStorySource) throw new Error('该功能需要 Windows 桌面版');
      await window.quickMap.openStorySource(sourceId);
    } catch (error) { announce(`无法打开来源：${error instanceof Error ? error.message : '请稍后重试'}`); }
  };

  const applyMapAskEvent = (event: MapAskEvent) => {
    const messageId = assistantMessageId.current;
    if (!messageId) return;
    if (event.type === 'started') {
      setChatMessages((previous) => previous.map((message) => message.id === messageId ? { ...message, status: 'streaming' } : message));
    } else if (event.type === 'conversation_reset') {
      const userMessageId = messageId.replace(/^assistant-/, 'user-');
      setChatMessages((previous) => previous.filter((message) => message.id === userMessageId || message.id === messageId));
      try { window.localStorage.removeItem(CHAT_STORAGE_KEY); } catch { /* Storage may be unavailable. */ }
      announce(event.message);
    } else if (event.type === 'delta') {
      setChatMessages((previous) => previous.map((message) => message.id === messageId ? { ...message, text: message.text + event.text, status: 'streaming' } : message));
    } else if (event.type === 'completed') {
      const stepIds = event.stepIds.filter((id) => storyStepById.has(id as StoryStep['id']));
      const sourceIds = event.sourceIds.filter((id) => Boolean(HORMUZ_STORY.sources[id]));
      setChatMessages((previous) => previous.map((message) => message.id === messageId ? { ...message, text: event.answer, stepIds, sourceIds, status: 'done' } : message));
      setAskBusy(false);
      askRequestId.current = null;
      assistantMessageId.current = null;
      if (stepIds[0] && !manualMapMovementSinceAsk.current) activateStoryStep(stepIds[0] as StoryStep['id'], false);
    } else if (event.type === 'cancelled') {
      setChatMessages((previous) => previous.map((message) => message.id === messageId ? { ...message, status: 'cancelled', text: '本次回复已取消。' } : message));
      setAskBusy(false);
      askRequestId.current = null;
      assistantMessageId.current = null;
    } else if (event.type === 'error') {
      setChatError(event.message);
      setChatMessages((previous) => previous.map((message) => message.id === messageId ? { ...message, status: 'error', text: '本次回复未完成。' } : message));
      setAskBusy(false);
      askRequestId.current = null;
      assistantMessageId.current = null;
    }
  };

  mapEventHandler.current = (event) => {
    if (askRequestId.current === 'pending') {
      const previous = bufferedMapEvents.current.get(event.requestId) ?? [];
      previous.push(event);
      bufferedMapEvents.current.set(event.requestId, previous);
    } else if (event.requestId === askRequestId.current) {
      applyMapAskEvent(event);
    }
  };

  const submitAsk = async () => {
    const prompt = askDraft.trim().slice(0, 2000);
    if (!prompt || askRequestId.current) return;
    setSideMode('chat');
    setChatError('');
    if (!window.quickMap?.askMap) { setChatError('地图内提问需要 QuickMap Windows 桌面版和本机 Codex；离线图文故事仍可浏览。'); return; }
    const generation = ++askGeneration.current;
    const messageId = `assistant-${generation}`;
    assistantMessageId.current = messageId;
    askRequestId.current = 'pending';
    manualMapMovementSinceAsk.current = false;
    bufferedMapEvents.current.clear();
    setAskBusy(true);
    setAskDraft('');
    setChatMessages((previous) => [...previous, { id: `user-${generation}`, role: 'user', text: prompt }, { id: messageId, role: 'assistant', text: '', status: 'streaming' }]);
    try {
      const { requestId } = await window.quickMap.askMap(prompt);
      if (generation !== askGeneration.current) { void window.quickMap.cancelMapAsk(requestId); return; }
      askRequestId.current = requestId;
      const buffered = bufferedMapEvents.current.get(requestId) ?? [];
      bufferedMapEvents.current.clear();
      for (const event of buffered) applyMapAskEvent(event);
    } catch (error) {
      if (generation !== askGeneration.current) return;
      askRequestId.current = null;
      assistantMessageId.current = null;
      bufferedMapEvents.current.clear();
      setAskBusy(false);
      setChatError(error instanceof Error ? error.message : '无法连接本机 Codex');
      setChatMessages((previous) => previous.map((message) => message.id === messageId ? { ...message, text: '本次回复未完成。', status: 'error' } : message));
    }
  };

  const cancelAsk = async () => {
    const requestId = askRequestId.current;
    if (!requestId) return;
    ++askGeneration.current;
    askRequestId.current = null;
    bufferedMapEvents.current.clear();
    const messageId = assistantMessageId.current;
    assistantMessageId.current = null;
    setAskBusy(false);
    setChatMessages((previous) => previous.map((message) => message.id === messageId ? { ...message, text: '本次回复已取消。', status: 'cancelled' } : message));
    try { await window.quickMap?.cancelMapAsk(requestId === 'pending' ? undefined : requestId); }
    catch (error) { setChatError(error instanceof Error ? error.message : '取消失败'); }
  };

  const resetChat = async () => {
    if (askRequestId.current) await cancelAsk();
    try { await window.quickMap?.resetMapConversation(); setChatMessages([]); setChatError(''); }
    catch (error) { setChatError(error instanceof Error ? error.message : '无法开始新会话'); }
  };

  useEffect(() => {
    const resize = () => { setSize({ width: window.innerWidth, height: window.innerHeight }); };
    window.addEventListener('resize', resize);
    const unsubscribe = window.quickMap?.onCommand((command) => commandHandler.current(command));
    const unsubscribeMapEvents = window.quickMap?.onMapEvent?.((event) => mapEventHandler.current(event));
    window.quickMap?.ready();
    return () => { window.removeEventListener('resize', resize); unsubscribe?.(); unsubscribeMapEvents?.(); };
  }, []);

  useEffect(() => {
    const completePairs: Array<[Pick<ChatMessage, 'role' | 'text'>, Pick<ChatMessage, 'role' | 'text' | 'stepIds' | 'sourceIds'>]> = [];
    for (let index = 0; index + 1 < chatMessages.length; index += 2) {
      const user = chatMessages[index], assistant = chatMessages[index + 1];
      if (user.role !== 'user' || assistant.role !== 'assistant' || assistant.status !== 'done') continue;
      completePairs.push([
        { role: 'user', text: user.text.slice(0, 2000) },
        { role: 'assistant', text: assistant.text.slice(0, 12000), stepIds: assistant.stepIds?.filter((id) => storyStepById.has(id as StoryStep['id'])), sourceIds: assistant.sourceIds?.filter((id) => Boolean(HORMUZ_STORY.sources[id])) },
      ]);
    }
    try { window.localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(completePairs.slice(-12))); }
    catch { /* An unavailable storage quota must not break offline story browsing. */ }
  }, [chatMessages]);

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
      focusTarget.current = null;
      if (askRequestId.current) manualMapMovementSinceAsk.current = true;
      const rect = svg.getBoundingClientRect();
      const x = event.clientX - rect.left, y = event.clientY - rect.top;
      setView((previous) => {
        const k = Math.max(0.8, Math.min(MAX_ZOOM, previous.k * Math.exp(-event.deltaY * 0.0015)));
        return { k, x: x - (x - previous.x) * k / previous.k, y: y - (y - previous.y) * k / previous.k };
      });
    };
    svg.addEventListener('wheel', wheel, { passive: false });
    return () => svg.removeEventListener('wheel', wheel);
  }, [hidden]);

  const zoom = (factor: number) => setView((previous) => {
    focusTarget.current = null;
    if (askRequestId.current) manualMapMovementSinceAsk.current = true;
    const k = Math.max(0.8, Math.min(MAX_ZOOM, previous.k * factor));
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
      focusTarget.current = null;
      if (askRequestId.current) manualMapMovementSinceAsk.current = true;
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.setPointerCapture(event.pointerId);
      setView({ ...drag.current.origin, x: drag.current.origin.x + dx, y: drag.current.origin.y + dy });
    }
  };
  const pointerUp = () => { drag.current = null; setDragging(false); };
  const pointerLeave = () => { if (!drag.current?.moved) drag.current = null; setHover(null); };

  if (hidden) return <div className="hidden-screen"><div className="brand-mark"><Icon name="globe"/></div><h1>地图已收起</h1><p>桌面应用中，使用全局快捷键随时唤出。</p><button className="primary-button" onClick={() => setHidden(false)}>返回地图 <Icon name="arrow"/></button></div>;

  return <main className="app-shell">
    <svg ref={svgRef} className={`world-map ${dragging ? 'is-dragging' : ''}`} width={size.width} height={size.height} aria-label="交互式离线世界地图，可拖动平移、滚轮缩放，点击国家或地区查看相邻地区和主要城市" role="img"
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
          className={`country ${selectedCode === country.code && !highlightCity ? 'selected' : ''} ${neighbors.has(country.code) && !highlightCity ? 'neighbor' : ''}`}
          vectorEffect="non-scaling-stroke"
          onPointerEnter={(event) => { if (!drag.current?.moved) setHover({ country, x: event.clientX, y: event.clientY }); }}
          onPointerMove={(event) => { if (!drag.current?.moved) setHover({ country, x: event.clientX, y: event.clientY }); }}
          onPointerLeave={() => setHover(null)}
          onClick={(event) => { event.stopPropagation(); if (!suppressClick.current) selectCountry(country); }}>
          <title>{country.nameZh} · {country.nameEn}{(country.capitalZh || country.capitalEn) ? ` · 首都 ${country.capitalZh || country.capitalEn}` : ''}</title>
        </path>)}
        {selected && !highlightCity && <g key={`${selected.code}-${selectionPulse}`} className="selected-region-emphasis" aria-hidden="true" pointerEvents="none">
          <path d={path(selected.geometry) ?? ''} className="selected-region-glow" vectorEffect="non-scaling-stroke"/>
          <path d={path(selected.geometry) ?? ''} className="selected-region-boundary" vectorEffect="non-scaling-stroke"/>
          <path d={path(selected.geometry) ?? ''} className="selected-region-pulse" vectorEffect="non-scaling-stroke"/>
        </g>}
        {view.k > 2.2 && countries.map((country) => {
          if (selectedCode === country.code && selectedCities.some((city) => city.nameZh === country.nameZh)) return null;
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
            <title>{city.nameZh || city.nameEn} · 城市位置点 · 暂无边界数据</title>
          </g>;
        })}
        {visibleStoryLayers.map((layer) => {
          const positions = layer.geometry.type === 'Point' ? [layer.geometry.coordinates] : layer.geometry.type === 'MultiPoint' ? layer.geometry.coordinates : null;
          const routePoints = layer.geometry.type === 'LineString' ? layer.geometry.coordinates.slice(-2).map((point) => projection(point)) : [];
          const routeEnd = routePoints.length === 2 && routePoints[0] && routePoints[1] ? routePoints[1] : null;
          const routeAngle = routeEnd && routePoints[0] ? Math.atan2(routeEnd[1] - routePoints[0][1], routeEnd[0] - routePoints[0][0]) * 180 / Math.PI : 0;
          const routeLabelPoint = positions ? null : path.centroid(layer.geometry);
          return <g key={layer.id} data-layer-id={layer.id} className={`story-map-layer ${layer.kind} ${activeStoryLayerIds.includes(layer.id) ? 'active' : ''}`}
            style={{ '--story-color': layer.color || '#8bd5c8' } as CSSProperties}
            role="button" tabIndex={0} aria-label={`${layer.label}，点击查看对应讲解`}
            onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); chooseStoryLayer(layer.id); } }}
            onClick={(event) => { event.stopPropagation(); if (!suppressClick.current) chooseStoryLayer(layer.id); }}>
            <title>{layer.label}。{layer.description}</title>
            {positions ? positions.map((position, index) => {
              const point = projection(position);
              if (!point) return null;
              return <g key={`${layer.id}-${index}`} transform={`translate(${point[0]},${point[1]}) scale(${1 / view.k})`}>
                <circle className="story-point-halo" r={layer.kind === 'strait' ? 23 : 13}/><circle className="story-point" r={layer.kind === 'strait' ? 7 : 5}/>
                {layer.pointLabels?.[index] && <text className="story-point-label" x={layer.pointLabelOffsets?.[index]?.[0] ?? 12} y={layer.pointLabelOffsets?.[index]?.[1] ?? 4} textAnchor={(layer.pointLabelOffsets?.[index]?.[0] ?? 12) < 0 ? 'end' : 'start'}>{layer.pointLabels[index]} · 示意</text>}
                {layer.kind === 'strait' && <text className="story-point-label" x="13" y="-11">霍尔木兹海峡 · 示意</text>}
              </g>;
            }) : <><path d={path(layer.geometry) ?? ''} className="story-route-hit" vectorEffect="non-scaling-stroke"/><path d={path(layer.geometry) ?? ''} className="story-route" vectorEffect="non-scaling-stroke"/>{routeEnd && <g transform={`translate(${routeEnd[0]},${routeEnd[1]}) rotate(${routeAngle}) scale(${1 / view.k})`} pointerEvents="none"><path className="story-arrowhead" d="M-12 -7 0 0 -12 7"/></g>}{routeLabelPoint?.every(Number.isFinite) && <g transform={`translate(${routeLabelPoint[0]},${routeLabelPoint[1]}) scale(${1 / view.k})`} pointerEvents="none"><text className="story-route-label" textAnchor="middle" y="-13">{layer.label}</text></g>}</>}
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
       <a className="brand" href="#" onClick={(event) => { event.preventDefault(); storyEntry.current = null; setStoryOpen(false); setSideMode(null); resetView(); setSelectedCode(null); setActiveOverlay(null); }} aria-label="Quick Map 返回世界视图"><span className="brand-mark"><Icon name="globe"/></span><span>Quick<span className="brand-light">Map</span><small>世界，随时在手边</small></span></a>
      <div className="topbar-right"><span className="offline-pill"><i/>离线地图 <span>OFFLINE</span></span><button className="hide-button" onClick={hide} title="收起地图 (Esc)">收起 <kbd>esc</kbd></button></div>
    </header>

    <section className="search-area" aria-label="地名搜索">
      <div className={`search-box ${searchOpen ? 'focused' : ''}`}><Icon name="search"/><input ref={searchRef} value={query} placeholder="搜索国家、地区、城市 / Search places" aria-label="搜索国家、地区或城市" role="combobox" aria-expanded={searchOpen} aria-controls="search-results" aria-autocomplete="list" aria-activedescendant={searchOpen && matches[resultIndex] ? `result-${matches[resultIndex].id}` : undefined}
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
      {!searchOpen && !selected && !active && !sideMode && <div className="map-intro"><span className="eyebrow">YOUR WORLD, AT A GLANCE</span><h1>每一个地名，<br/>都有了位置。</h1><p>悬停认识各地，点击探索邻近地区与城市。<br/>从一段文字，抵达世界的任何角落。</p><div className="intro-rule"/><span className="intro-caption">{countries.length} 个国家与地区 · 全程离线</span></div>}
    </section>

    {(selected || active) && !sideMode && <aside className="detail-panel" aria-label={selected ? '地区详情' : '临时标注详情'}>
      <div className="panel-topline"><span className="eyebrow">{selected ? 'EXPLORE A REGION' : 'DYNAMIC MAP LAYER'}</span><button className="icon-button small" aria-label="关闭详情" onClick={() => { setSelectedCode(null); setActiveOverlay(null); }}><Icon name="close"/></button></div>
      {selected ? <>
        <div className="country-code">{highlightedCity ? 'CITY POINT' : selected.code}</div><h2>{highlightedCity ? highlightedCity.nameZh || highlightedCity.nameEn : selected.nameZh}</h2><p className="english-name">{highlightedCity ? highlightedCity.nameEn : selected.nameEn}</p>
        {highlightedCity && <div className="city-boundary-note"><Icon name="pin"/><div><strong>城市位置点 · 暂无边界数据</strong><span>所属国家/地区：{selected.nameZh}。{selected.code === 'HK' ? '香港另有“地区轮廓”，与这个城市点是两条不同记录。' : '此圆点不代表行政边界。'}</span><button onClick={() => selectCountry(selected)}>查看{selected.nameZh}地区轮廓 <Icon name="arrow"/></button></div></div>}
        {!highlightedCity && (selected.capitalZh || selected.capitalEn) && <div className="capital-card"><span className="capital-star">★</span><div><span className="field-label">首都 / CAPITAL</span><strong>{selected.capitalZh || selected.capitalEn}</strong>{selected.capitalZh && selected.capitalEn && <small>{selected.capitalEn}</small>}</div></div>}
        <div className="section-heading"><h3>相邻地区</h3><span>{neighbors.size.toString().padStart(2, '0')}</span></div>
        <div className="neighbor-list">{selected.neighbors.length ? selected.neighbors.map((code) => { const neighbor = countryByCode.get(code); return neighbor ? <button key={code} onClick={() => selectCountry(neighbor)}><span className="neighbor-dot"/>{neighbor.nameZh}<Icon name="arrow"/></button> : null; }) : <p className="muted-note">没有陆地接壤的地区</p>}</div>
        <div className="section-heading"><h3>主要城市</h3><span>{selectedCities.length.toString().padStart(2, '0')}</span></div>
        <div className="city-list">{selectedCities.length ? selectedCities.map((city) => <button key={city.id} className={highlightCity === city.id ? 'active' : ''} onClick={() => { setHighlightCity(city.id); focusPoint(city.lon, city.lat, 8); }}><span className={`city-list-dot ${city.isCapital ? 'is-capital' : ''}`}/><span>{city.nameZh || city.nameEn}<small>{city.nameEn} · 位置点</small></span>{city.isCapital ? <span className="capital-tag">首都</span> : <Icon name="arrow"/>}</button>) : <p className="muted-note">当前离线数据暂无城市记录</p>}</div>
        <div className="panel-coordinate"><Icon name="pin"/>{coordinate(highlightedCity?.lon ?? selected.lon, highlightedCity?.lat ?? selected.lat)}</div>
      </> : active ? <>
        <div className="overlay-badge"><Icon name="layers"/>临时标注</div><h2 className="overlay-title">{active.label}</h2><p className="overlay-description">{active.description || '由本地 AI 或工具添加的地图标注。'}</p>
        <div className="overlay-metadata"><span>几何类型</span><strong>{geometryLabels[active.geometry.type]}</strong>{active.source && <><span>来源</span><strong>{active.source}</strong></>}{active.expiresAt && <><span>有效期至</span><strong>{new Date(active.expiresAt).toLocaleString('zh-CN')}</strong></>}</div>
        <button className="secondary-button" onClick={() => { if (active.geometry.type === 'Point') focusPoint(...active.geometry.coordinates, 7); else focusGeometry(active.geometry); }}><Icon name="expand"/>定位标注</button>
        <button className="text-button danger" onClick={() => { setOverlays((previous) => previous.filter((overlay) => overlay.id !== active.id)); setActiveOverlay(null); }}>移除此标注</button>
      </> : null}
    </aside>}

    {sideMode && <aside className="story-panel" aria-label={sideMode === 'story' ? '霍尔木兹图文故事' : '问地图回复'}>
      <div className="story-panel-head"><div><span className="eyebrow">QUICKMAP / EXPLORE</span><strong>{sideMode === 'story' ? '图文故事' : '问地图'}</strong></div><button className="icon-button small" aria-label="关闭侧栏" onClick={() => { if (storyOpen) exitStory(); else setSideMode(null); }}><Icon name="close"/></button></div>
      <div className="story-tabs"><button className={sideMode === 'story' ? 'active' : ''} onClick={() => storyOpen ? setSideMode('story') : activateStoryStep('hormuz-1')}>霍尔木兹故事</button><button className={sideMode === 'chat' ? 'active' : ''} onClick={() => setSideMode('chat')}>Codex 回复{chatMessages.length > 0 ? ` · ${Math.ceil(chatMessages.length / 2)}` : ''}</button></div>
      {sideMode === 'story' ? <div className="story-panel-scroll" key={storyStep.id}>
        <div className="story-kicker">{storyStep.eyebrow} <span>共 {HORMUZ_STORY.steps.length} 步</span></div>
        <h2>{storyStep.title}</h2><p className="story-subtitle">{HORMUZ_STORY.subtitle}</p>
        <div className="story-progress" aria-label="故事步骤">{HORMUZ_STORY.steps.map((step, index) => <button key={step.id} className={step.id === storyStep.id ? 'active' : ''} aria-label={`第 ${index + 1} 步：${step.title}`} aria-current={step.id === storyStep.id ? 'step' : undefined} onClick={() => activateStoryStep(step.id)}>{index + 1}</button>)}</div>
        <div className="story-paragraphs">{storyStep.paragraphs.map((paragraph) => <button id={`story-paragraph-${paragraph.id}`} key={paragraph.id} className={`story-paragraph ${activeStoryParagraphId === paragraph.id ? 'active' : ''}`} onClick={() => { setActiveStoryParagraphId(paragraph.id); focusStoryLayerIds(paragraph.layerIds); }}><span className="story-paragraph-dot"/><span>{paragraph.text}<small>定位地图：{paragraph.layerIds.map((id) => storyLayerById.get(id)?.label).filter(Boolean).join('、')}</small></span></button>)}</div>
        {storyStep.claims.length > 0 && <div className="story-claims">{storyStep.claims.map((claim) => <div key={claim.id} className="story-claim"><span>{claim.label}</span><strong>{claim.value}<small>{claim.unit}</small></strong><p>{claim.period}{claim.qualifier ? ` · ${claim.qualifier}` : ''}</p><button onClick={() => void openSource(claim.sourceId)}>查看来源 <Icon name="arrow"/></button></div>)}</div>}
        <div className="story-legend"><span>示意图层</span><p>{HORMUZ_STORY.legend}</p><div><i className="legend-sea"/>海运方向<i className="legend-pipe"/>陆上管道<i className="legend-place"/>位置点</div></div>
        <div className="story-sources"><span>资料来源 · 截至 {HORMUZ_STORY.asOf}</span>{storyStep.sourceIds.map((id) => <button key={id} onClick={() => void openSource(id)}>{HORMUZ_STORY.sources[id]?.title}<small>{HORMUZ_STORY.sources[id]?.period}</small><Icon name="arrow"/></button>)}</div>
        <div className="story-nav"><button onClick={() => activateStoryStep(HORMUZ_STORY.steps[Math.max(0, HORMUZ_STORY.steps.findIndex((step) => step.id === storyStep.id) - 1)].id)} disabled={storyStep.id === 'hormuz-1'}>← 上一步</button><button onClick={() => focusStoryCamera(storyStep.camera)}>回到本步视角</button><button onClick={() => activateStoryStep(HORMUZ_STORY.steps[Math.min(HORMUZ_STORY.steps.length - 1, HORMUZ_STORY.steps.findIndex((step) => step.id === storyStep.id) + 1)].id)} disabled={storyStep.id === 'hormuz-5'}>下一步 →</button></div>
        <button className="story-exit" onClick={exitStory}>退出故事，恢复进入前的地图视角</button>
      </div> : <div className="story-panel-scroll chat-scroll">
        <p className="chat-context">这是 QuickMap 管理的独立 Codex 会话，使用本机 Codex 默认模型，不共享当前桌面对话。目前仅支持霍尔木兹故事；开放式地图问答见 GitHub Issue #3。</p>
        {chatMessages.length === 0 ? <div className="chat-empty"><span>✦</span><strong>询问霍尔木兹故事</strong><p>例如“为什么霍尔木兹海峡重要？”；其他地理话题请先在 Codex 对话中查询并操作地图。</p></div> : chatMessages.map((message) => <div key={message.id} className={`chat-message ${message.role}`}><span>{message.role === 'user' ? '你' : 'Codex'}{message.status === 'streaming' ? ' · 正在回复' : message.status === 'cancelled' ? ' · 已取消' : ''}</span><p>{message.text || (message.status === 'streaming' ? '正在连接本机 Codex…' : '')}</p>{message.stepIds?.length ? <div className="chat-step-links">{message.stepIds.map((id) => { const step = storyStepById.get(id as StoryStep['id']); return step ? <button key={id} onClick={() => activateStoryStep(step.id)}>查看地图：{step.title} <Icon name="arrow"/></button> : null; })}</div> : null}{message.sourceIds?.length ? <div className="chat-source-links">{message.sourceIds.map((id) => HORMUZ_STORY.sources[id] ? <button key={id} onClick={() => void openSource(id)}>来源：{HORMUZ_STORY.sources[id].title}</button> : null)}</div> : null}</div>)}
        {chatError && <div className="chat-error" role="alert">{chatError}</div>}
        <div className="chat-actions">{askBusy && <button onClick={() => void cancelAsk()}>取消本次回复</button>}{chatMessages.length > 0 && !askBusy && <button onClick={() => void resetChat()}>开始新会话</button>}</div>
      </div>}
    </aside>}

    <div className="bottom-left">
      <div className="ask-card"><div className="ask-heading"><span className="ai-symbol">✦</span><div><strong>问地图</strong><small>霍尔木兹故事问答 · 预览版</small></div>{overlays.length > 0 && <span className="layer-count" title={`${overlays.length} 个临时标注`}>{overlays.length}</span>}</div><div className="ask-input-row"><textarea value={askDraft} aria-label="向地图提问" placeholder="例如：为什么霍尔木兹海峡这么重要？" rows={2} onChange={(event) => setAskDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submitAsk(); } }}/><button aria-label="发送给本机 Codex" disabled={askBusy || !askDraft.trim()} onClick={() => void submitAsk()}><Icon name="arrow"/></button></div><div className="ask-links"><button onClick={() => activateStoryStep('hormuz-1')}>离线浏览：霍尔木兹五步故事 <Icon name="arrow"/></button>{chatMessages.length > 0 && sideMode !== 'chat' && <button onClick={() => setSideMode('chat')}>查看回复</button>}</div></div>
      {overlays.length > 0 && <div className="layer-strip" aria-label="临时图层">{overlays.map((overlay) => <button className={activeOverlay === overlay.id ? 'active' : ''} key={overlay.id} onClick={() => { setActiveOverlay(overlay.id); setSelectedCode(null); if (overlay.geometry.type === 'Point') focusPoint(...overlay.geometry.coordinates, 7); else focusGeometry(overlay.geometry); }}><i style={{ background: overlay.color || '#f4b968' }}/>{overlay.label.split(' · ')[0]}</button>)}<button className="clear-layers" onClick={() => { setOverlays([]); setActiveOverlay(null); }} title="清除全部临时标注"><Icon name="close"/></button></div>}
    </div>

    <nav className="map-controls" aria-label="地图视图控制"><button aria-label="放大" title="放大" onClick={() => zoom(1.5)}><Icon name="plus"/></button><button aria-label="缩小" title="缩小" onClick={() => zoom(1 / 1.5)}><Icon name="minus"/></button><span/><button aria-label="返回世界视图" title="世界视图 (Home)" onClick={resetView}><Icon name="globe"/></button></nav>
    <footer className="map-footer"><span><i/>LOCAL EXPLORER <b>01</b></span><div className="map-legend"><span><i className="selected-key"/>当前地区</span><span><i className="neighbor-key"/>相邻地区</span><span><i className="city-key"/>主要城市</span></div><span className="footer-hint">拖动平移<span>·</span>滚轮缩放<span>·</span>{view.k.toFixed(1)}×<span className="data-attribution">地图数据 © Natural Earth</span></span></footer>
    {hover && !dragging && <div className="country-tooltip" style={{ left: Math.min(size.width - 255, Math.max(12, hover.x + 17)), top: Math.max(90, Math.min(size.height - 130, hover.y + 17)) }}><span className="tooltip-code">{hover.country.code}</span><strong>{hover.country.nameZh}</strong><span className="tooltip-english">{hover.country.nameEn}</span>{(hover.country.capitalZh || hover.country.capitalEn) && <div><span>首都</span>{hover.country.capitalZh || hover.country.capitalEn}</div>}<small>点击探索相邻地区与主要城市 <Icon name="arrow"/></small></div>}
    <div className={`toast ${notice ? 'visible' : ''}`} role="status" aria-live="polite">{notice}</div>
  </main>;
}
