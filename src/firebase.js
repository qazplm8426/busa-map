// Firebase 기본 연결
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// Firebase 프로젝트 설정
const firebaseConfig = {
  apiKey: "AIzaSyBlmYKRweve8V1pytvcdZo_Owr0I3Ty5A8",
  authDomain: "busa-map-30271.firebaseapp.com",
  projectId: "busa-map-30271",
  storageBucket: "busa-map-30271.firebasestorage.app",
  messagingSenderId: "795748392495",
  appId: "1:795748392495:web:c1ab02eb024959c29370da"
};

// Firebase 초기화
const app = initializeApp(firebaseConfig);

// Firestore 데이터베이스 연결
export const db = getFirestore(app);