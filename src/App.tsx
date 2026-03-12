import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "./firebase.js";

type Team = "1조" | "2조" | "3조";
type Grade = 1 | 2 | 3 | 4;

type Spot = {
  id: string;
  lat: number;
  lng: number;
  title: string;
  team: Team;
  hasCctv: boolean;
  over10Lux: boolean;
  over4People: boolean;
  checkedCount: number;
  grade: Grade;
};

const BUSA_CENTER: [number, number] = [36.3168, 127.4319];
const BUSA_BOUNDS: L.LatLngBoundsExpression = [
  [36.3055, 127.4225],
  [36.3258, 127.4418],
];

const gradeColor: Record<Grade, string> = {
  1: "#16a34a", // 초록
  2: "#eab308", // 노랑
  3: "#f97316", // 주황
  4: "#dc2626", // 빨강
};

function getGrade(checkedCount: number): Grade {
  if (checkedCount === 3) return 1;
  if (checkedCount === 2) return 2;
  if (checkedCount === 1) return 3;
  return 4;
}

function createDivIcon(color: string) {
  return L.divIcon({
    className: "",
    html: `<div style="background:${color};width:18px;height:18px;border-radius:9999px;border:2px solid white;box-shadow:0 0 0 1px rgba(0,0,0,0.25)"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

export default function App() {
  const mapRef = useRef<L.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const longPressTimerRef = useRef<number | null>(null);

  const [spots, setSpots] = useState<Spot[]>([]);
  const [picked, setPicked] = useState<{ lat: number; lng: number } | null>(null);
  const [title, setTitle] = useState("");
  const [team, setTeam] = useState<Team>("1조");
  const [hasCctv, setHasCctv] = useState(false);
  const [over10Lux, setOver10Lux] = useState(false);
  const [over4People, setOver4People] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const spotsCol = collection(db, "busaSafetySpots");

  const checkedCount = Number(hasCctv) + Number(over10Lux) + Number(over4People);
  const previewGrade = getGrade(checkedCount);

  const summary = useMemo(() => {
    return {
      total: spots.length,
      g1: spots.filter((s) => s.grade === 1).length,
      g2: spots.filter((s) => s.grade === 2).length,
      g3: spots.filter((s) => s.grade === 3).length,
      g4: spots.filter((s) => s.grade === 4).length,
    };
  }, [spots]);

  // 지도 초기화
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: BUSA_CENTER,
      zoom: 17,
      minZoom: 15,
      maxZoom: 20,
      maxBounds: BUSA_BOUNDS,
      maxBoundsViscosity: 0.5,
    });

    mapRef.current = map;

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 20,
    }).addTo(map);

    markersLayerRef.current = L.layerGroup().addTo(map);

    setTimeout(() => map.invalidateSize(), 300);

    const startLongPress = (e: L.LeafletMouseEvent) => {
      if (longPressTimerRef.current) window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = window.setTimeout(() => {
        setEditingId(null);
        setTitle("");
        setTeam("1조");
        setHasCctv(false);
        setOver10Lux(false);
        setOver4People(false);
        setPicked({
          lat: Number(e.latlng.lat.toFixed(6)),
          lng: Number(e.latlng.lng.toFixed(6)),
        });
      }, 600);
    };

    const cancelLongPress = () => {
      if (longPressTimerRef.current) {
        window.clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
    };

    map.on("mousedown", startLongPress);
    map.on("mouseup", cancelLongPress);
    map.on("mouseout", cancelLongPress);
    map.on("touchstart", startLongPress);
    map.on("touchend", cancelLongPress);

    return () => {
      map.off();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Firestore 실시간 구독
  useEffect(() => {
  const q = query(spotsCol);
  const unsub = onSnapshot(
    q,
    (snapshot) => {
      const next: Spot[] = snapshot.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<Spot, "id">),
      }));
      setSpots(next);
      setLoading(false);
    },
    (error) => {
      console.error("Firestore 오류:", error);
      setLoading(false);
    }
  );

  return () => unsub();
}, []);

  // 지도에 핀 렌더링
  useEffect(() => {
    if (!markersLayerRef.current) return;

    markersLayerRef.current.clearLayers();

    spots.forEach((spot) => {
      const marker = L.marker([spot.lat, spot.lng], {
        icon: createDivIcon(gradeColor[spot.grade]),
      });

      marker.bindPopup(`
        <div style="min-width:180px;font-size:14px;">
          <div style="font-weight:700;">${spot.title || "이름 없는 지점"}</div>
          <div style="margin-top:6px;">${spot.team} · ${spot.grade}등급</div>
          <div style="margin-top:6px;">CCTV: ${spot.hasCctv ? "있음" : "없음"}</div>
          <div>빛 10 lux 초과: ${spot.over10Lux ? "예" : "아니오"}</div>
          <div>유동인구 4명 이상: ${spot.over4People ? "예" : "아니오"}</div>
        </div>
      `);

      marker.on("click", () => {
        setEditingId(spot.id);
        setPicked({ lat: spot.lat, lng: spot.lng });
        setTitle(spot.title);
        setTeam(spot.team);
        setHasCctv(spot.hasCctv);
        setOver10Lux(spot.over10Lux);
        setOver4People(spot.over4People);
      });

      markersLayerRef.current?.addLayer(marker);
    });
  }, [spots]);

  const resetForm = () => {
    setPicked(null);
    setEditingId(null);
    setTitle("");
    setTeam("1조");
    setHasCctv(false);
    setOver10Lux(false);
    setOver4People(false);
  };

  const saveSpot = async () => {
    if (!picked) return;

    const payload = {
      lat: picked.lat,
      lng: picked.lng,
      title: title.trim(),
      team,
      hasCctv,
      over10Lux,
      over4People,
      checkedCount,
      grade: previewGrade,
      updatedAt: serverTimestamp(),
    };

    if (editingId) {
      await updateDoc(doc(db, "busaSafetySpots", editingId), payload);
    } else {
      await addDoc(spotsCol, {
        ...payload,
        createdAt: serverTimestamp(),
      });
    }

    resetForm();
  };

  const deleteSpot = async () => {
    if (!editingId) return;
    await deleteDoc(doc(db, "busaSafetySpots", editingId));
    resetForm();
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9", padding: "12px" }}>
      <div
        style={{
          maxWidth: "1400px",
          margin: "0 auto",
          display: "grid",
          gap: "16px",
          gridTemplateColumns: "380px 1fr",
        }}
      >
        <section style={{ background: "white", borderRadius: "24px", padding: "20px" }}>
          <h1 style={{ fontSize: "28px", fontWeight: 700, marginBottom: "8px" }}>
            부사동 안전 사각지대 지도
          </h1>
          <p style={{ fontSize: "14px", lineHeight: 1.6, color: "#475569" }}>
            휴대폰에서 지도를 길게 누르면 핀이 생성되고, 체크리스트에 따라 등급이 자동 계산됩니다.
            친구들과 같은 링크로 접속하면 실시간으로 핀이 공유됩니다.
          </p>

          <div style={{ marginTop: "16px", padding: "14px", background: "#f8fafc", borderRadius: "16px" }}>
            <div style={{ fontWeight: 600, fontSize: "14px" }}>선택한 위치</div>
            <div style={{ marginTop: "8px", fontSize: "14px", color: "#475569" }}>
              {picked ? `${picked.lat}, ${picked.lng}` : "지도를 길게 눌러 위치를 먼저 선택하세요."}
            </div>
          </div>

          <div style={{ marginTop: "16px" }}>
            <div style={{ marginBottom: "8px", fontSize: "14px", fontWeight: 600 }}>장소 이름</div>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="비워도 저장 가능"
              style={{ width: "100%", padding: "10px", borderRadius: "12px", border: "1px solid #cbd5e1" }}
            />
          </div>

          <div style={{ marginTop: "16px" }}>
            <div style={{ marginBottom: "8px", fontSize: "14px", fontWeight: 600 }}>조 선택</div>
            <select
              value={team}
              onChange={(e) => setTeam(e.target.value as Team)}
              style={{ width: "100%", padding: "10px", borderRadius: "12px", border: "1px solid #cbd5e1" }}
            >
              <option>1조</option>
              <option>2조</option>
              <option>3조</option>
            </select>
          </div>

          <div style={{ marginTop: "16px", border: "1px solid #e2e8f0", borderRadius: "16px", padding: "16px" }}>
            <div style={{ marginBottom: "12px", fontSize: "14px", fontWeight: 600 }}>체크리스트</div>

            <label style={{ display: "block", marginBottom: "10px" }}>
              <input type="checkbox" checked={hasCctv} onChange={(e) => setHasCctv(e.target.checked)} /> CCTV 있음
            </label>
            <label style={{ display: "block", marginBottom: "10px" }}>
              <input type="checkbox" checked={over10Lux} onChange={(e) => setOver10Lux(e.target.checked)} /> 빛 10 lux 초과
            </label>
            <label style={{ display: "block" }}>
              <input type="checkbox" checked={over4People} onChange={(e) => setOver4People(e.target.checked)} /> 유동인구 4명 이상
            </label>
          </div>

          <div style={{ marginTop: "16px", background: "#0f172a", color: "white", borderRadius: "16px", padding: "16px" }}>
            <div style={{ fontSize: "14px", fontWeight: 600 }}>자동 계산 결과</div>
            <div style={{ marginTop: "8px", fontSize: "14px" }}>체크된 항목 수: {checkedCount}개</div>
            <div style={{ marginTop: "6px", fontSize: "20px", fontWeight: 700 }}>예상 등급: {previewGrade}등급</div>
          </div>

          <div style={{ marginTop: "16px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
            <button onClick={saveSpot} style={{ padding: "12px", borderRadius: "16px", background: "#0f172a", color: "white", border: "none" }}>
              {editingId ? "핀 수정 저장" : "핀 저장하기"}
            </button>
            <button onClick={resetForm} style={{ padding: "12px", borderRadius: "16px", background: "#e2e8f0", border: "none" }}>
              입력 초기화
            </button>
          </div>

          {editingId && (
            <div style={{ marginTop: "8px" }}>
              <button onClick={deleteSpot} style={{ padding: "12px", borderRadius: "16px", background: "#fee2e2", color: "#b91c1c", border: "none", width: "100%" }}>
                현재 수정 중인 핀 삭제
              </button>
            </div>
          )}

          <div style={{ marginTop: "16px", fontSize: "13px", color: "#64748b" }}>
            {loading ? "실시간 데이터를 불러오는 중..." : "실시간 공유 연결됨"}
          </div>
        </section>

        <section style={{ position: "relative", background: "white", borderRadius: "24px", padding: "12px" }}>
          <div style={{ marginBottom: "12px" }}>
            <div style={{ fontSize: "20px", fontWeight: 700 }}>부사동 조사 지도</div>
            <div style={{ fontSize: "14px", color: "#475569", marginTop: "4px" }}>
              휴대폰에서 길게 눌러 핀을 만들고, 등급별 색상으로 바로 확인하세요.
            </div>
          </div>

          <div ref={mapContainerRef} style={{ width: "100%", height: "78vh", minHeight: "620px", borderRadius: "24px", overflow: "hidden" }} />

          <div
            style={{
              position: "absolute",
              right: "20px",
              bottom: "20px",
              background: "rgba(255,255,255,0.95)",
              border: "1px solid #e2e8f0",
              borderRadius: "16px",
              padding: "14px",
              boxShadow: "0 10px 25px rgba(0,0,0,0.08)",
            }}
          >
            <div style={{ fontSize: "14px", fontWeight: 700 }}>요약 현황</div>
            <div style={{ marginTop: "8px", fontSize: "14px" }}>전체 핀: {summary.total}개</div>
            <div style={{ marginTop: "4px", fontSize: "13px", color: "#15803d" }}>1등급: {summary.g1}개</div>
            <div style={{ marginTop: "4px", fontSize: "13px", color: "#ca8a04" }}>2등급: {summary.g2}개</div>
            <div style={{ marginTop: "4px", fontSize: "13px", color: "#ea580c" }}>3등급: {summary.g3}개</div>
            <div style={{ marginTop: "4px", fontSize: "13px", color: "#dc2626" }}>4등급: {summary.g4}개</div>
          </div>
        </section>
      </div>
    </div>
  );
}