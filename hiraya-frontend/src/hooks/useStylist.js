import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import api, { parseApiError } from '../api/axios';
import { FALLBACK_ANCHORS } from '../utils/containRect';

/*
 * useStylist — the AI Stylist's flow in the Studio.
 *
 *   photo accepted ─► analyse photo (async, polled) ─► style-profile modal
 *        (customer confirms palette, occasion, collection) ─► lookbook drawn on
 *        the photo ─► "Try this look" (render) ─► verdict on the render
 *
 * "AI describes, rules choose, the customer decides": the analysis only
 * SUGGESTS an undertone and finds the body points; the backend rules
 * (config/stylist.php) choose every piece.
 *
 * It drives useTryOnState through its public functions only (applySavedOutfit,
 * handleGenerateFitting, …), so the existing render pipeline is unchanged.
 */

const POLL_MS = 1500;
const POLL_LIMIT = 40; // ~60 s, then the palette falls back to "pick one"

// "Try this look": the callout cards glide into their body dots first (UI
// only), then the look is loaded and the render starts.
const TRY_HANDOFF_MS = 480;
const TRY_SETTLE_MS = 5000; // if the stack never holds the look, step back

/** A lookbook piece -> the garment shape the Style Stack / render expects. */
const toGarment = (piece) => ({
  id: piece.id,
  productId: piece.id,
  name: piece.name,
  price: piece.price,
  // The Studio ROW: a one-piece outfit is a dress; everything else resolves
  // from the catalog label exactly as a bag item would.
  category: piece.region === 'full' ? 'dress' : piece.region === 'lower' ? 'bottom' : piece.category,
  productCategory: piece.category,
  image_url: piece.raw_image_url || piece.image_url,
  raw_image_url: piece.raw_image_url || piece.image_url,
  display_image_url: piece.display_image_url || piece.image_url,
  ghost_mannequin_url: piece.ghost_mannequin_url || null,
  selected_size: piece.size || '',
  selected_color: piece.color || 'Standard',
  source: 'stylist',
});

export const useStylist = ({
  userPhotoBase64,
  photoRejection,
  selectedGarments,
  applySavedOutfit,
  handleGenerateFitting,
  canGenerate,
  isGenerating,
  tryOnStatus,
  generatedImage,
  sessionId,
}) => {
  const [profile, setProfile] = useState(null);
  const [analysis, setAnalysis] = useState({ status: 'idle', result: null });
  const [modalOpen, setModalOpen] = useState(false);
  const [answers, setAnswers] = useState({ undertone: null, occasion: 'everyday', preference: null });
  const [lookbook, setLookbook] = useState({ status: 'idle', data: null, error: null });
  const [activeLook, setActiveLook] = useState(0);
  const [swaps, setSwaps] = useState({});
  const [verdict, setVerdict] = useState({ status: 'idle', data: null, sessionId: null });
  const [trying, setTrying] = useState(false);
  // UI only: the slot the customer is pointing at (links card ⇄ body), and
  // per-slot swap direction + count so the cards and dots can animate a swap.
  const [activeSlot, setActiveSlot] = useState(null);
  const [swapMeta, setSwapMeta] = useState({});
  const reduce = useReducedMotion();

  const analysedPhotoRef = useRef(null);
  const pollRef = useRef({ timer: null, token: 0 });
  const touchedUndertoneRef = useRef(false);
  const pendingTryRef = useRef(null);
  const lastTriedRef = useRef(null);
  const tryTimerRef = useRef(null);

  // ---- profile (sizes, saved answers, occasion list) ----------------------
  useEffect(() => {
    let alive = true;
    api.get('/stylist/profile')
      .then(({ data }) => {
        if (!alive) return;
        setProfile(data);
        setAnswers((a) => ({
          ...a,
          occasion: data?.style_profile?.last_occasion || a.occasion,
          preference: data?.effective_preference || a.preference,
          undertone: a.undertone ?? data?.style_profile?.undertone ?? null,
        }));
      })
      .catch(() => { /* the modal still works with defaults */ });
    return () => { alive = false; };
  }, []);

  const stopPolling = useCallback(() => {
    clearTimeout(pollRef.current.timer);
    pollRef.current.token += 1;
  }, []);

  const resetStylist = useCallback(() => {
    stopPolling();
    clearTimeout(tryTimerRef.current);
    pendingTryRef.current = null;
    setTrying(false);
    analysedPhotoRef.current = null;
    touchedUndertoneRef.current = false;
    setAnalysis({ status: 'idle', result: null });
    setModalOpen(false);
    setLookbook({ status: 'idle', data: null, error: null });
    setVerdict({ status: 'idle', data: null, sessionId: null });
    setSwaps({});
    setSwapMeta({});
    setActiveSlot(null);
    setActiveLook(0);
  }, [stopPolling]);

  // ---- 1. a newly accepted photo starts the analysis + opens the modal -----
  useEffect(() => {
    if (!userPhotoBase64 || photoRejection) {
      if (analysedPhotoRef.current) resetStylist();
      return;
    }
    if (analysedPhotoRef.current === userPhotoBase64) return;

    analysedPhotoRef.current = userPhotoBase64;
    touchedUndertoneRef.current = false;
    stopPolling();
    const token = pollRef.current.token;

    setLookbook({ status: 'idle', data: null, error: null });
    setVerdict({ status: 'idle', data: null, sessionId: null });
    setAnalysis({ status: 'processing', result: null });
    setModalOpen(true);

    const settle = (entry) => {
      if (pollRef.current.token !== token) return;
      if (entry?.status === 'done' && entry.result) {
        setAnalysis({ status: 'done', result: entry.result });
        if (!touchedUndertoneRef.current) {
          setAnswers((a) => ({ ...a, undertone: entry.result.undertone }));
        }
      } else {
        setAnalysis({ status: 'failed', result: null });
      }
    };

    const poll = (hash, attempt) => {
      if (pollRef.current.token !== token) return;
      if (attempt >= POLL_LIMIT) {
        settle(null);
        return;
      }
      pollRef.current.timer = setTimeout(async () => {
        try {
          const { data } = await api.get(`/stylist/analyze-photo/${hash}`);
          if (data?.status === 'processing') poll(hash, attempt + 1);
          else settle(data);
        } catch {
          poll(hash, attempt + 1);
        }
      }, POLL_MS);
    };

    api.post('/stylist/analyze-photo', { image: userPhotoBase64 })
      .then(({ data }) => {
        if (data?.status === 'processing') poll(data.hash, 0);
        else settle(data);
      })
      .catch(() => settle(null));
  }, [userPhotoBase64, photoRejection, resetStylist, stopPolling]);

  useEffect(() => () => {
    clearTimeout(pollRef.current.timer);
    clearTimeout(tryTimerRef.current);
  }, []);

  const setAnswer = useCallback((key, value) => {
    if (key === 'undertone') touchedUndertoneRef.current = true;
    setAnswers((a) => ({ ...a, [key]: value }));
  }, []);

  // ---- 2. the customer's answers -> rules -> lookbook ----------------------
  const showLooks = useCallback(async (override = null) => {
    const chosen = { ...answers, ...(override || {}) };
    setModalOpen(false);
    setLookbook({ status: 'loading', data: null, error: null });
    setVerdict({ status: 'idle', data: null, sessionId: null });

    api.put('/stylist/profile', {
      undertone: chosen.undertone,
      preference: chosen.preference,
      occasion: chosen.occasion,
    }).catch(() => { /* saving the profile is best-effort */ });

    try {
      const { data } = await api.post('/stylist/lookbook', {
        occasion: chosen.occasion,
        preference: chosen.preference,
        undertone: chosen.undertone,
      });
      setLookbook({ status: 'ready', data, error: null });
      setActiveLook(0);
      setSwaps({});
      setSwapMeta({});
      setActiveSlot(null);
    } catch (err) {
      setLookbook({ status: 'error', data: null, error: parseApiError(err).message });
    }
  }, [answers]);

  // ---- 3. browsing: look A/B/C and the per-piece ‹ › swaps ----------------
  const looks = lookbook.data?.looks ?? [];
  const look = looks[activeLook] ?? null;

  const resolvedPieces = useMemo(() => {
    if (!look) return [];
    const chosen = swaps[look.id] || {};
    return look.pieces.map((main) => {
      const index = chosen[main.slot] || 0;
      const piece = index > 0 ? main.alternatives?.[index - 1] : null;
      return piece
        ? { ...piece, slot: main.slot, alternatives: main.alternatives, optionIndex: index, optionCount: (main.alternatives?.length || 0) + 1, main }
        : { ...main, optionIndex: 0, optionCount: (main.alternatives?.length || 0) + 1, main };
    });
  }, [look, swaps]);

  const markSwapped = useCallback((slots, dir) => {
    setSwapMeta((m) => {
      const next = { ...m };
      slots.forEach((slot) => { next[slot] = { dir, n: (m[slot]?.n || 0) + 1 }; });
      return next;
    });
  }, []);

  const swapPiece = useCallback((slot, step) => {
    if (!look) return;
    const main = look.pieces.find((p) => p.slot === slot);
    const count = (main?.alternatives?.length || 0) + 1;
    if (count < 2) return;
    setSwaps((s) => {
      const current = s[look.id]?.[slot] || 0;
      return { ...s, [look.id]: { ...(s[look.id] || {}), [slot]: (current + step + count) % count } };
    });
    markSwapped([slot], step);
  }, [look, markSwapped]);

  const changeLook = useCallback((step) => {
    if (looks.length < 2) return;
    setActiveLook((i) => (i + step + looks.length) % looks.length);
    setActiveSlot(null);
  }, [looks.length]);

  const selectLook = useCallback((index) => {
    if (index >= 0 && index < looks.length) {
      setActiveLook(index);
      setActiveSlot(null);
    }
  }, [looks.length]);

  /*
   * "Surprise me": a random mix of the look's alternatives. Every alternative
   * already passed the rules, so a shuffle can only land on approved pieces.
   * It always changes at least one piece, so the tap is never a no-op.
   */
  const canShuffle = !!look?.pieces?.some((p) => (p.alternatives?.length || 0) > 0);
  const shuffleLook = useCallback(() => {
    if (!look) return;
    const current = swaps[look.id] || {};
    const next = {};
    look.pieces.forEach((main) => {
      const count = (main.alternatives?.length || 0) + 1;
      if (count > 1) next[main.slot] = Math.floor(Math.random() * count);
    });
    let changed = Object.keys(next).filter((slot) => next[slot] !== (current[slot] || 0));
    if (changed.length === 0) {
      const first = look.pieces.find((m) => (m.alternatives?.length || 0) > 0);
      if (!first) return;
      next[first.slot] = ((current[first.slot] || 0) + 1) % (first.alternatives.length + 1);
      changed = [first.slot];
    }
    setSwaps((s) => ({ ...s, [look.id]: { ...current, ...next } }));
    markSwapped(changed, 1);
  }, [look, swaps, markSwapped]);

  // ---- 4. "Try this look": load EXACTLY the look, then render --------------
  const tryLook = useCallback(() => {
    if (!look || isGenerating || trying) return;
    const pieces = resolvedPieces.filter((p) => p.renderable !== false);
    if (pieces.length === 0) return;
    const pending = {
      ids: pieces.map((p) => p.id),
      lookId: look.id,
      occasion: lookbook.data?.occasion?.key || answers.occasion,
      undertone: lookbook.data?.undertone ?? answers.undertone,
      pieces: pieces.map((p) => ({ id: p.id, color: p.color, size: p.size })),
    };
    setTrying(true);
    clearTimeout(tryTimerRef.current);
    tryTimerRef.current = setTimeout(() => {
      applySavedOutfit(pieces.map(toGarment), { replace: true });
      pendingTryRef.current = pending;
      tryTimerRef.current = setTimeout(() => {
        if (pendingTryRef.current !== pending) return;
        pendingTryRef.current = null;
        setTrying(false);
      }, TRY_SETTLE_MS);
    }, reduce ? 0 : TRY_HANDOFF_MS);
  }, [look, resolvedPieces, applySavedOutfit, isGenerating, trying, lookbook.data, answers, reduce]);

  // The stack update is async: render once the selection really holds the look.
  useEffect(() => {
    const pending = pendingTryRef.current;
    if (!pending) return;
    const selectedIds = Object.values(selectedGarments || {}).filter(Boolean).map((g) => g.productId ?? g.id);
    if (!pending.ids.every((id) => selectedIds.includes(id))) return;
    pendingTryRef.current = null;
    clearTimeout(tryTimerRef.current);
    if (!canGenerate) {
      setTrying(false);
      return;
    }
    lastTriedRef.current = pending;
    handleGenerateFitting();
  }, [selectedGarments, canGenerate, handleGenerateFitting]);

  // The render overlay has taken over: the hand-off is finished.
  useEffect(() => {
    if (isGenerating) setTrying(false);
  }, [isGenerating]);

  // ---- 5. verdict on a finished render -------------------------------------
  useEffect(() => {
    if (tryOnStatus !== 'completed' || !generatedImage || !sessionId) return;
    if (verdict.sessionId === sessionId) return;

    const tried = lastTriedRef.current;
    const pieces = tried?.pieces ?? Object.values(selectedGarments || {})
      .filter((g) => g && (g.productId ?? g.id))
      .map((g) => ({ id: Number(g.productId ?? g.id), color: g.selected_color || null, size: g.selected_size || null }));
    if (pieces.length === 0) return;

    setVerdict({ status: 'loading', data: null, sessionId });
    api.post('/stylist/verdict', {
      session_id: sessionId,
      occasion: tried?.occasion || lookbook.data?.occasion?.key || answers.occasion,
      undertone: tried?.undertone ?? answers.undertone,
      pieces,
    })
      .then(({ data }) => setVerdict({ status: 'ready', data, sessionId }))
      .catch(() => setVerdict({ status: 'error', data: null, sessionId }));
  }, [tryOnStatus, generatedImage, sessionId, verdict.sessionId, selectedGarments, lookbook.data, answers]);

  const anchors = useMemo(() => {
    const found = analysis.result?.anchors || {};
    return {
      torso: found.torso || FALLBACK_ANCHORS.torso,
      legs: found.legs || FALLBACK_ANCHORS.legs,
      feet: found.feet || FALLBACK_ANCHORS.feet,
    };
  }, [analysis.result]);

  return {
    profile,
    analysis,
    anchors,
    modalOpen,
    openModal: () => setModalOpen(true),
    closeModal: () => setModalOpen(false),
    answers,
    setAnswer,
    showLooks,
    lookbook,
    looks,
    look,
    activeLook,
    changeLook,
    selectLook,
    resolvedPieces,
    swapPiece,
    swapMeta,
    activeSlot,
    setActiveSlot,
    canShuffle,
    shuffleLook,
    tryLook,
    trying,
    verdict,
    resetStylist,
  };
};
