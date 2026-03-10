import React, { useState, useEffect } from 'react';
import {
    DndContext,
    useSensor,
    useSensors,
    MouseSensor,
    TouchSensor,
    useDraggable,
    useDroppable,
    DragOverlay,
    defaultDropAnimationSideEffects
} from '@dnd-kit/core';
import './AlphabetMatchGame.css';
import { saveAlphabetProgressToFirestore } from './firebase';

const ALPHABETS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split('');

// --- 브라우저 자체 전자음 (Web Audio API) ---
// 실제 mp3 파일이 없어도 소리가 납니다!
const AudioContext = window.AudioContext || window.webkitAudioContext;
const audioCtx = new AudioContext();

function playTone(freq, type, duration, vol = 0.5, delayMs = 0) {
    setTimeout(() => {
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();

        oscillator.type = type;
        oscillator.frequency.setValueAtTime(freq, audioCtx.currentTime);

        gainNode.gain.setValueAtTime(vol, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);

        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        oscillator.start();
        oscillator.stop(audioCtx.currentTime + duration);
    }, delayMs);
}

function playWrong() {
    // 삐빅! 하는 오답 소리
    playTone(200, 'sawtooth', 0.2, 0.3, 0);
    playTone(150, 'sawtooth', 0.3, 0.3, 150);
}

function playTada() {
    // 띠로링~ 5개 완성 소리 (밝은 화음 멜로디)
    playTone(523.25, 'sine', 0.2, 0.5, 0);   // C5
    playTone(659.25, 'sine', 0.2, 0.5, 100); // E5
    playTone(783.99, 'sine', 0.4, 0.5, 200); // G5
    playTone(1046.50, 'sine', 0.6, 0.5, 300); // C6
}

function playCheer() {
    // 뾰롱뾰롱뾰로롱~ 전체 완성 소리 (신나는 화음 아르페지오)
    const notes = [523.25, 659.25, 783.99, 1046.50, 1318.51, 1567.98, 2093.00];
    notes.forEach((freq, idx) => {
        playTone(freq, 'sine', 0.4, 0.3, idx * 80);
        playTone(freq, 'triangle', 0.4, 0.3, idx * 80 + 40); // 겹쳐서 풍성하게
    });
}

// --- Draggable Component ---
function DraggableLetter({ id, letter, isMatched }) {
    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
        id: `drag-${id}`,
        data: { letter },
        disabled: isMatched
    });

    const style = transform ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        zIndex: isDragging ? 999 : 1,
        opacity: isDragging ? 0 : 1, // 끄는 동안은 원본을 숨기거나 반투명하게
    } : undefined;

    return (
        <div
            ref={setNodeRef}
            style={style}
            {...listeners}
            {...attributes}
            className={`draggable-letter ${isMatched ? 'matched' : ''} ${isDragging ? 'dragging' : ''}`}
        >
            {letter}
        </div>
    );
}

// --- Droppable Component ---
function DroppableSlot({ id, expectedLetter, matched }) {
    const { isOver, setNodeRef } = useDroppable({
        id: `drop-${id}`,
        data: { expectedLetter }
    });

    const isMatched = matched.includes(expectedLetter);

    return (
        <div
            ref={setNodeRef}
            className={`droppable-slot ${isOver && !isMatched ? 'is-over' : ''} ${isMatched ? 'matched' : ''}`}
        >
            {isMatched ? <span className="matched-text">{expectedLetter.toUpperCase()}</span> : expectedLetter.toLowerCase()}
        </div>
    );
}

// --- Main Game Component ---
export default function AlphabetMatchGame() {
    const [availableLetters, setAvailableLetters] = useState([]);
    const [currentBatch, setCurrentBatch] = useState([]); // [{ upper, lower }]
    const [shuffledUpper, setShuffledUpper] = useState([]);
    const [shuffledLower, setShuffledLower] = useState([]);
    const [matchedLetters, setMatchedLetters] = useState([]); // 현재 배치에서 매칭된 글자들
    const [totalMatched, setTotalMatched] = useState([]); // 전체 매칭된 글자들 (오늘)
    const [activeId, setActiveId] = useState(null);
    const [isCompleted, setIsCompleted] = useState(false);

    // ─── Firebase에 오늘 배운 알파벳 저장 ───
    useEffect(() => {
        if (totalMatched.length > 0) {
            const today = new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
            saveAlphabetProgressToFirestore(today, totalMatched);
        }
    }, [totalMatched]);

    // ─── 초기화 ───
    useEffect(() => {
        startNewGame();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const shuffleArray = (array) => {
        const arr = [...array];
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    };

    const startNewGame = () => {
        const initialLetters = shuffleArray([...ALPHABETS]);
        setAvailableLetters(initialLetters);
        setTotalMatched([]);
        setIsCompleted(false);
        loadNextBatch(initialLetters);
    };

    const loadNextBatch = (lettersList) => {
        if (lettersList.length === 0) {
            setIsCompleted(true);
            playCheer();
            return;
        }

        const batch = lettersList.slice(0, 5);
        setAvailableLetters(lettersList.slice(5));

        setCurrentBatch(batch);
        setShuffledUpper(shuffleArray(batch));
        setShuffledLower(shuffleArray(batch)); // 아래쪽 슬롯도 섞을지 여부 (섞으면 더 어려움)
        setMatchedLetters([]);
    };

    // ─── TTS: 알파벳 읽어주기 ───
    const getFemaleVoice = () => {
        const voices = window.speechSynthesis.getVoices();
        let voice = voices.find(v => v.name === 'Google US English');
        if (!voice) voice = voices.find(v => v.lang.startsWith('en') && v.name.toLowerCase().includes('female'));
        if (!voice) voice = voices.find(v => v.name.includes('Zira') || v.name.includes('Samantha'));
        return voice;
    };

    const speakLetter = (letter) => {
        const synth = window.speechSynthesis;
        synth.cancel();
        const utterance = new SpeechSynthesisUtterance(letter);
        utterance.lang = 'en-US';
        utterance.rate = 0.8;
        const voice = getFemaleVoice();
        if (voice) utterance.voice = voice;
        synth.speak(utterance);
    };

    // ─── Dnd Sensors ───
    const mouseSensor = useSensor(MouseSensor, {
        // 5px 이상 움직여야 drag 시작 (클릭과 구분)
        activationConstraint: {
            distance: 5,
        },
    });
    const touchSensor = useSensor(TouchSensor, {
        activationConstraint: {
            delay: 50,
            tolerance: 5,
        },
    });
    const sensors = useSensors(mouseSensor, touchSensor);

    // ─── Drag Events ───
    const handleDragStart = (event) => {
        setActiveId(event.active.id);
    };

    const handleDragEnd = (event) => {
        const { active, over } = event;
        setActiveId(null);

        if (over && over.data.current) {
            const draggedLetter = active.data.current.letter;
            const targetLetter = over.data.current.expectedLetter;

            if (draggedLetter === targetLetter) {
                // 정답!
                speakLetter(draggedLetter);

                const newMatched = [...matchedLetters, draggedLetter];
                setMatchedLetters(newMatched);
                setTotalMatched(prev => {
                    if (!prev.includes(draggedLetter)) return [...prev, draggedLetter];
                    return prev;
                });

                // 현재 배치 다 맞추면 다음 배치로
                if (newMatched.length === currentBatch.length) {
                    setTimeout(() => {
                        playTada();
                        loadNextBatch(availableLetters);
                    }, 1500); // 박수/파티클 이펙트 볼 시간 (1.5초)
                }
            } else {
                // 오답! (dnd-kit이 알아서 원래 자리로 부드럽게 돌아감)
                playWrong();
            }
        }
    };

    // DragOverlay 에 띄울 컴포넌트 찾기
    const activeLetter = activeId ? activeId.replace('drag-', '') : null;

    return (
        <div className="alphabet-match-container">
            <div className="game-header">
                <h2>대문자-소문자 짝맞추기</h2>
                <p>친구들을 맞는 자리에 쏘옥 넣어주세요!</p>
            </div>

            {isCompleted ? (
                <div className="completion-screen">
                    <div className="celebration-emoji">🎉</div>
                    <h2>우와! 참 잘했어요!</h2>
                    <p>모든 알파벳을 다 맞췄어요.</p>
                    <button className="restart-btn" onClick={startNewGame}>다시 하기</button>
                </div>
            ) : (
                <DndContext
                    sensors={sensors}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                >
                    <div className="play-area">
                        {/* 상단: 드래그 할 대문자 블록들 */}
                        <div className="draggable-zone">
                            {shuffledUpper.map((letter) => (
                                <DraggableLetter
                                    key={`upper-${letter}`}
                                    id={letter}
                                    letter={letter}
                                    isMatched={matchedLetters.includes(letter)}
                                />
                            ))}
                        </div>

                        {/* 하단: 드롭할 소문자 빈칸들 */}
                        <div className="droppable-zone">
                            {shuffledLower.map((letter) => (
                                <DroppableSlot
                                    key={`lower-${letter}`}
                                    id={letter}
                                    expectedLetter={letter}
                                    matched={matchedLetters}
                                />
                            ))}
                        </div>
                    </div>

                    <DragOverlay dropAnimation={{
                        sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: '0.5' } } }),
                    }}>
                        {activeId ? (
                            <div className="draggable-letter dragging-overlay">
                                {activeLetter}
                            </div>
                        ) : null}
                    </DragOverlay>
                </DndContext>
            )}

            <div className="progress-status">
                남은 알파벳: {availableLetters.length + currentBatch.length - matchedLetters.length}개
            </div>
        </div>
    );
}
