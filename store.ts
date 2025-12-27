
import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { initializeApp } from "firebase/app";
import { getDatabase, ref, onValue, set, update, push, child } from "firebase/database";
import { User, Tournament, PaymentRequest, AppSettings, ChatMessage } from './types';

// Your web app's Firebase configuration from your prompt
const firebaseConfig = {
  apiKey: "AIzaSyDQcNfcQOkH6rfr4z_vgdG6yUYJJ0SDqKw",
  authDomain: "rdsapp-910f3.firebaseapp.com",
  databaseURL: "https://rdsapp-910f3-default-rtdb.firebaseio.com",
  projectId: "rdsapp-910f3",
  storageBucket: "rdsapp-910f3.firebasestorage.app",
  messagingSenderId: "193789962907",
  appId: "1:193789962907:web:60dae855eed6d454bef43e"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

interface State {
  currentUser: User | null;
  users: User[];
  tournaments: Tournament[];
  payments: PaymentRequest[];
  settings: AppSettings;
  messages: ChatMessage[];
}

interface StoreContextType extends State {
  login: (identifier: string, password: string) => { success: boolean; msg: string };
  register: (newUser: Omit<User, 'balance' | 'role' | 'joinedMatches'>) => { success: boolean; msg: string };
  logout: () => void;
  updateProfile: (updatedUser: Partial<User>) => void;
  adminUpdateUser: (userId: string, updates: Partial<User>) => void;
  addTournament: (t: Tournament) => void;
  removeTournament: (id: string) => void;
  updateTournament: (updated: Tournament) => void;
  addPaymentRequest: (p: PaymentRequest) => void;
  processPayment: (id: string, status: 'APPROVED' | 'REJECTED') => void;
  joinTournament: (tournamentId: string, playerNames: string[], type: 'SOLO' | 'DUO' | 'SQUAD', fee: number) => { success: boolean; msg: string };
  setSettings: (s: AppSettings) => void;
  sendMessage: (msg: string, receiverId: string) => void;
}

const StoreContext = createContext<StoreContextType | undefined>(undefined);

export const StoreProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [state, setState] = useState<State>({
    currentUser: JSON.parse(localStorage.getItem('ff_user') || 'null'),
    users: [],
    tournaments: [],
    payments: [],
    settings: {
      adminBkash: '01700000000',
      adminNagad: '01900000000',
      marqueeNotice: 'Loading...',
      minDeposit: 100,
      minWithdraw: 200
    },
    messages: []
  });

  // Fetch data from Firebase
  useEffect(() => {
    const dbRef = ref(db);
    const unsubscribe = onValue(dbRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        setState(prev => ({
          ...prev,
          users: Object.values(data.users || {}),
          tournaments: Object.values(data.tournaments || {}),
          payments: Object.values(data.payments || {}),
          settings: data.settings || prev.settings,
          messages: Object.values(data.messages || {})
        }));
      }
    });
    return () => unsubscribe();
  }, []);

  const login = (identifier: string, password: string) => {
    const user = state.users.find(u => (u.phone === identifier || u.email === identifier) && u.password === password);
    if (user) {
      localStorage.setItem('ff_user', JSON.stringify(user));
      setState(prev => ({ ...prev, currentUser: user }));
      return { success: true, msg: 'লগইন সফল হয়েছে' };
    }
    return { success: false, msg: 'আইডি বা পাসওয়ার্ড ভুল!' };
  };

  const register = (newUser: Omit<User, 'balance' | 'role' | 'joinedMatches'>) => {
    const exists = state.users.some(u => u.phone === newUser.phone || u.email === newUser.email);
    if (exists) return { success: false, msg: 'এই ফোন বা আইডি দিয়ে অলরেডি অ্যাকাউন্ট আছে' };
    
    const fullUser: User = { ...newUser, balance: 0, role: 'PLAYER', joinedMatches: [] };
    set(ref(db, 'users/' + fullUser.id), fullUser);
    localStorage.setItem('ff_user', JSON.stringify(fullUser));
    setState(prev => ({ ...prev, currentUser: fullUser }));
    return { success: true, msg: 'অ্যাকাউন্ট তৈরি সফল হয়েছে' };
  };

  const logout = () => {
    localStorage.removeItem('ff_user');
    setState(prev => ({ ...prev, currentUser: null }));
  };

  const updateProfile = (updatedUser: Partial<User>) => {
    if (!state.currentUser) return;
    const updates = { ...updatedUser };
    update(ref(db, 'users/' + state.currentUser.id), updates);
  };

  const adminUpdateUser = (userId: string, updates: Partial<User>) => {
    update(ref(db, 'users/' + userId), updates);
  };

  const addTournament = (t: Tournament) => {
    set(ref(db, 'tournaments/' + t.id), t);
  };
  
  const removeTournament = (id: string) => {
    set(ref(db, 'tournaments/' + id), null);
  };

  const updateTournament = (updated: Tournament) => {
    update(ref(db, 'tournaments/' + updated.id), updated);
  };

  const addPaymentRequest = (p: PaymentRequest) => {
    set(ref(db, 'payments/' + p.id), p);
  };

  const processPayment = (id: string, status: 'APPROVED' | 'REJECTED') => {
    const payment = state.payments.find(p => p.id === id);
    if (!payment || payment.status !== 'PENDING') return;

    const user = state.users.find(u => u.id === payment.userId);
    if (!user) return;

    const updates: any = {};
    updates[`payments/${id}/status`] = status;
    
    if (status === 'APPROVED') {
      const newBalance = payment.type === 'DEPOSIT' ? user.balance + payment.amount : user.balance - payment.amount;
      updates[`users/${user.id}/balance`] = newBalance;
    }

    update(ref(db), updates);
  };

  const joinTournament = (tournamentId: string, playerNames: string[], type: string, fee: number) => {
    if (!state.currentUser) return { success: false, msg: 'লগইন করুন' };
    const user = state.users.find(u => u.id === state.currentUser?.id);
    if (!user || user.balance < fee) return { success: false, msg: 'পর্যাপ্ত ব্যালেন্স নেই' };

    const tournament = state.tournaments.find(t => t.id === tournamentId);
    if (!tournament) return { success: false, msg: 'টুর্নামেন্ট পাওয়া যায়নি' };

    const newPlayer = { userId: user.id, names: playerNames, matchType: type, entryPaid: fee };
    const updates: any = {};
    const playerIndex = tournament.players ? tournament.players.length : 0;
    
    updates[`tournaments/${tournamentId}/players/${playerIndex}`] = newPlayer;
    updates[`users/${user.id}/balance`] = user.balance - fee;
    const joinedMatches = user.joinedMatches || [];
    updates[`users/${user.id}/joinedMatches/${joinedMatches.length}`] = tournamentId;

    update(ref(db), updates);
    return { success: true, msg: 'সফলভাবে যোগ দিয়েছেন' };
  };

  const setSettings = (s: AppSettings) => {
    set(ref(db, 'settings'), s);
  };

  const sendMessage = (msg: string, receiverId: string) => {
    if (!state.currentUser) return;
    const msgId = Math.random().toString(36).substring(7);
    const newMsg: ChatMessage = { id: msgId, senderId: state.currentUser.id, receiverId, message: msg, timestamp: Date.now() };
    set(ref(db, 'messages/' + msgId), newMsg);
  };

  return React.createElement(
    StoreContext.Provider,
    {
      value: {
        ...state,
        login,
        register,
        logout,
        updateProfile,
        adminUpdateUser,
        addTournament,
        removeTournament,
        updateTournament,
        addPaymentRequest,
        processPayment,
        joinTournament,
        setSettings,
        sendMessage,
      },
    },
    children
  );
};

export const useStore = () => {
  const context = useContext(StoreContext);
  if (!context) throw new Error('useStore must be used within a StoreProvider');
  return context;
};
