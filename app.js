/**
 * PL-900 Mock Test Platform - Core Logic
 */

document.addEventListener("DOMContentLoaded", () => {
  // --- APPLICATION STATE ---
  let questions = [];
  let currentQuestionIndex = 0;
  let userAnswers = {}; // Map of question index -> array of selected options, e.g. { 0: ["C"], 2: ["A", "B"] }
  let markedForReview = new Set(); // Set of question indexes marked for review
  let timeRemaining = 50 * 60; // 50 minutes in seconds
  let timerInterval = null;
  let examStartTime = null;
  let isExamSubmitted = false;

  // 10 Complex questions worth 3 marks (total 30 marks)
  // 35 standard questions worth 2 marks (total 70 marks)
  // Total 100 marks. Pass mark 84%.
  const complexQuestionsList = ["Q3", "Q7", "Q8", "Q16", "Q18", "Q25", "Q26", "Q27", "Q29", "Q36"];

  // --- DOM ELEMENTS ---
  const homeView = document.getElementById("home-view");
  const quizView = document.getElementById("quiz-view");
  const resultView = document.getElementById("result-view");
  const headerStatus = document.getElementById("header-status");
  const timerDisplay = document.getElementById("timer-display");
  const timerCard = document.getElementById("timer-card");
  
  const questionProgressText = document.getElementById("question-progress-text");
  const progressBarFill = document.getElementById("progress-bar-fill");
  const questionText = document.getElementById("question-text");
  const optionsContainer = document.getElementById("options-container");
  
  const prevBtn = document.getElementById("prev-btn");
  const nextBtn = document.getElementById("next-btn");
  const reviewBtn = document.getElementById("review-btn");
  const reviewBtnText = document.getElementById("review-btn-text");
  const submitExamBtn = document.getElementById("submit-exam-btn");
  
  const paletteGrid = document.getElementById("palette-grid");
  const paletteCountText = document.getElementById("palette-count");
  const paletteReviewCountText = document.getElementById("palette-review-count");
  
  const confirmModal = document.getElementById("confirm-modal");
  const modalCancelBtn = document.getElementById("modal-cancel-btn");
  const modalConfirmBtn = document.getElementById("modal-confirm-btn");
  const modalUnansweredWarning = document.getElementById("modal-unanswered-warning");
  const unansweredCountText = document.getElementById("unanswered-count-text");

  // Results elements
  const resultBanner = document.getElementById("result-banner");
  const resultStatusBadge = document.getElementById("result-status-badge");
  const scorePercentageCircle = document.getElementById("score-percentage-circle");
  const scorePercentageText = document.getElementById("score-percentage-text");
  const scoreBreakdownText = document.getElementById("score-breakdown-text");
  const statTimeSpent = document.getElementById("stat-time-spent");
  const statCorrectCount = document.getElementById("stat-correct-count");
  const reviewList = document.getElementById("review-list");
  
  const startExamBtn = document.getElementById("start-exam-btn");
  const restartBtn = document.getElementById("restart-btn");

  // --- INITIALIZATION ---
  async function init() {
    try {
      const response = await fetch("questions.json");
      if (!response.ok) {
        throw new Error("Failed to load questions database.");
      }
      questions = await response.ok ? await response.json() : [];
      if (questions.length === 0) {
        throw new Error("Questions list is empty.");
      }
      setupEventListeners();
    } catch (error) {
      console.error(error);
      alert("Error loading test questions. Please ensure you are running this app via a local HTTP web server (e.g., Python http.server or Node serve) to prevent browser CORS blocks.");
    }
  }

  // --- VIEW TRANSITION HELPER ---
  function safeNavigate(domUpdateCallback, focusTargetId = null) {
    if (!document.startViewTransition) {
      domUpdateCallback();
      if (focusTargetId) {
        document.getElementById(focusTargetId)?.focus();
      }
      return;
    }
    
    const transition = document.startViewTransition(domUpdateCallback);
    if (focusTargetId) {
      transition.finished.finally(() => {
        document.getElementById(focusTargetId)?.focus();
      });
    }
  }

  // --- EVENT LISTENERS ---
  function setupEventListeners() {
    startExamBtn.addEventListener("click", startExam);
    prevBtn.addEventListener("click", showPreviousQuestion);
    nextBtn.addEventListener("click", showNextQuestion);
    reviewBtn.addEventListener("click", toggleMarkForReview);
    submitExamBtn.addEventListener("click", openSubmitModal);
    
    modalCancelBtn.addEventListener("click", closeSubmitModal);
    modalConfirmBtn.addEventListener("click", () => {
      closeSubmitModal();
      submitExam();
    });
    
    restartBtn.addEventListener("click", restartExam);
    
    // Close modal on escape key or clicking backdrop
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && confirmModal.style.display !== "none") {
        closeSubmitModal();
      }
    });
    confirmModal.addEventListener("click", (e) => {
      if (e.target === confirmModal) {
        closeSubmitModal();
      }
    });
  }

  // --- EXAM FLOW FUNCTIONS ---

  function startExam() {
    safeNavigate(() => {
      homeView.style.display = "none";
      quizView.style.display = "block";
      headerStatus.style.display = "flex";
      
      currentQuestionIndex = 0;
      userAnswers = {};
      markedForReview.clear();
      timeRemaining = 50 * 60; // 50 mins
      isExamSubmitted = false;
      examStartTime = Date.now();
      
      buildQuestionPalette();
      renderQuestion();
      startTimer();
    }, "question-text");
  }

  function startTimer() {
    clearInterval(timerInterval);
    updateTimerDisplay();
    
    timerInterval = setInterval(() => {
      timeRemaining--;
      updateTimerDisplay();
      
      if (timeRemaining <= 0) {
        clearInterval(timerInterval);
        alert("Time is up! Your exam will be submitted automatically.");
        submitExam();
      }
    }, 1000);
  }

  function updateTimerDisplay() {
    const minutes = Math.floor(timeRemaining / 60);
    const seconds = timeRemaining % 60;
    const formattedTime = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    timerDisplay.textContent = formattedTime;
    
    // Alert user visually when under 5 minutes
    if (timeRemaining <= 5 * 60) {
      timerCard.classList.add("danger");
    } else {
      timerCard.classList.remove("danger");
    }
  }

  function buildQuestionPalette() {
    paletteGrid.innerHTML = "";
    questions.forEach((q, idx) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "palette-btn";
      btn.textContent = idx + 1;
      btn.setAttribute("aria-label", `Go to question ${idx + 1}`);
      btn.addEventListener("click", () => {
        jumpToQuestion(idx);
      });
      paletteGrid.appendChild(btn);
    });
    updateQuestionPaletteStates();
  }

  function updateQuestionPaletteStates() {
    const buttons = paletteGrid.querySelectorAll(".palette-btn");
    let answeredCount = 0;
    
    buttons.forEach((btn, idx) => {
      // Clear status classes
      btn.className = "palette-btn";
      
      const isCurrent = idx === currentQuestionIndex;
      const isAnswered = userAnswers[idx] && userAnswers[idx].length > 0;
      const isReview = markedForReview.has(idx);
      
      if (isCurrent) btn.classList.add("current");
      if (isAnswered) {
        btn.classList.add("answered");
        answeredCount++;
      }
      if (isReview) btn.classList.add("review");
    });
    
    paletteCountText.textContent = `${answeredCount}/45 Answered`;
    paletteReviewCountText.textContent = `${markedForReview.size} Review`;
  }

  function getQuestionWeight(q) {
    return complexQuestionsList.includes(q.id) ? 3 : 2;
  }

  function renderQuestion() {
    const q = questions[currentQuestionIndex];
    const weight = getQuestionWeight(q);
    
    // Header updates
    questionProgressText.textContent = `Question ${currentQuestionIndex + 1} of 45`;
    
    // Progress bar fill percentage
    const fillPercent = ((currentQuestionIndex + 1) / questions.length) * 100;
    progressBarFill.style.width = `${fillPercent}%`;
    
    // Check if multi-select
    const isMultiSelect = q.correctAnswer.length > 1;
    
    // Set question text
    if (isMultiSelect) {
      questionText.innerHTML = `${q.id}. ${q.question} <span class="select-all-apply" style="display: block; font-size: 15px; font-weight: 500; color: var(--text-muted); margin-top: 8px;">(Select all that apply)</span>`;
    } else {
      questionText.textContent = `${q.id}. ${q.question}`;
    }
    
    // Render options
    optionsContainer.innerHTML = "";
    Object.entries(q.options).forEach(([key, val]) => {
      const optionLabel = document.createElement("label");
      optionLabel.className = "option-label";
      
      const input = document.createElement("input");
      input.type = isMultiSelect ? "checkbox" : "radio";
      input.name = "option-group";
      input.value = key;
      input.className = "option-input";
      
      // Restore previous answers
      if (userAnswers[currentQuestionIndex] && userAnswers[currentQuestionIndex].includes(key)) {
        input.checked = true;
        optionLabel.classList.add("checked");
      }
      
      // Update label highlight on state change
      input.addEventListener("change", () => {
        handleOptionSelection(isMultiSelect);
      });
      
      const indicator = document.createElement("span");
      indicator.className = isMultiSelect ? "option-checkbox-indicator" : "option-radio-indicator";
      
      const textWrapper = document.createElement("div");
      textWrapper.className = "option-text-wrapper";
      
      const letter = document.createElement("span");
      letter.className = "option-letter";
      letter.textContent = `${key}. `;
      
      const content = document.createElement("span");
      content.className = "option-text-content";
      content.textContent = val;
      
      textWrapper.appendChild(letter);
      textWrapper.appendChild(content);
      
      optionLabel.appendChild(input);
      optionLabel.appendChild(indicator);
      optionLabel.appendChild(textWrapper);
      
      optionsContainer.appendChild(optionLabel);
    });
    
    // Update navigation buttons
    prevBtn.disabled = currentQuestionIndex === 0;
    if (currentQuestionIndex === questions.length - 1) {
      nextBtn.style.display = "none";
      submitExamBtn.style.display = "inline-flex";
    } else {
      nextBtn.style.display = "inline-flex";
      submitExamBtn.style.display = "none";
    }
    
    // Update review button status
    if (markedForReview.has(currentQuestionIndex)) {
      reviewBtn.classList.add("active");
      reviewBtnText.textContent = "Marked for Review";
    } else {
      reviewBtn.classList.remove("active");
      reviewBtnText.textContent = "Marked for Review";
    }
    
    updateQuestionPaletteStates();
  }

  function handleOptionSelection(isMultiSelect) {
    const checkedInputs = optionsContainer.querySelectorAll(".option-input:checked");
    const selectedValues = Array.from(checkedInputs).map(inp => inp.value);
    
    // Update selected visual borders
    const labels = optionsContainer.querySelectorAll(".option-label");
    labels.forEach(lbl => {
      const inp = lbl.querySelector(".option-input");
      if (inp.checked) {
        lbl.classList.add("checked");
      } else {
        lbl.classList.remove("checked");
      }
    });

    if (selectedValues.length > 0) {
      userAnswers[currentQuestionIndex] = selectedValues;
    } else {
      delete userAnswers[currentQuestionIndex];
    }
    
    updateQuestionPaletteStates();
  }

  function showNextQuestion() {
    if (currentQuestionIndex < questions.length - 1) {
      jumpToQuestion(currentQuestionIndex + 1);
    }
  }

  function showPreviousQuestion() {
    if (currentQuestionIndex > 0) {
      jumpToQuestion(currentQuestionIndex - 1);
    }
  }

  function toggleMarkForReview() {
    if (markedForReview.has(currentQuestionIndex)) {
      markedForReview.delete(currentQuestionIndex);
      reviewBtn.classList.remove("active");
    } else {
      markedForReview.add(currentQuestionIndex);
      reviewBtn.classList.add("active");
    }
    updateQuestionPaletteStates();
  }

  function jumpToQuestion(idx) {
    safeNavigate(() => {
      currentQuestionIndex = idx;
      renderQuestion();
    }, "question-text");
  }

  // --- SUBMIT EXAM FLOW ---

  function openSubmitModal() {
    // Count unanswered questions
    let unansweredCount = 0;
    for (let i = 0; i < questions.length; i++) {
      if (!userAnswers[i] || userAnswers[i].length === 0) {
        unansweredCount++;
      }
    }

    if (unansweredCount > 0) {
      modalUnansweredWarning.style.display = "flex";
      unansweredCountText.textContent = `You have ${unansweredCount} unanswered questions.`;
    } else {
      modalUnansweredWarning.style.display = "none";
    }

    confirmModal.style.display = "flex";
    confirmModal.setAttribute("aria-hidden", "false");
  }

  function closeSubmitModal() {
    confirmModal.style.display = "none";
    confirmModal.setAttribute("aria-hidden", "true");
  }

  function submitExam() {
    clearInterval(timerInterval);
    isExamSubmitted = true;
    
    const timeTakenSecs = Math.floor((Date.now() - examStartTime) / 1000);
    const timeTakenMins = Math.floor(timeTakenSecs / 60);
    const timeTakenRemainingSecs = timeTakenSecs % 60;
    const timeSpentStr = `${timeTakenMins} min(s) ${timeTakenRemainingSecs} sec(s)`;
    
    // Grading
    let totalScore = 0;
    let correctCount = 0;
    
    questions.forEach((q, idx) => {
      const weight = getQuestionWeight(q);
      const answers = userAnswers[idx] || [];
      
      // Sort to compare arrays directly
      const sortedAnswers = [...answers].sort();
      const sortedCorrect = [...q.correctAnswer].sort();
      
      const isCorrect = JSON.stringify(sortedAnswers) === JSON.stringify(sortedCorrect);
      
      if (isCorrect) {
        totalScore += weight;
        correctCount++;
      }
    });

    const passed = totalScore >= 84; // 84 marks needed to pass

    // Update Result View
    safeNavigate(() => {
      quizView.style.display = "none";
      resultView.style.display = "block";
      headerStatus.style.display = "none";
      
      // Update result classes
      if (passed) {
        resultView.className = "view-card passed";
        resultStatusBadge.textContent = "PASSED";
        resultStatusBadge.style.backgroundColor = "var(--success)";
      } else {
        resultView.className = "view-card failed";
        resultStatusBadge.textContent = "FAILED";
        resultStatusBadge.style.backgroundColor = "var(--danger)";
      }
      
      // Circle Progress Animation
      scorePercentageText.textContent = `${totalScore}%`;
      const dashoffset = 100 - totalScore;
      scorePercentageCircle.style.strokeDasharray = `${totalScore}, 100`;
      
      // Scores
      scoreBreakdownText.textContent = `You scored ${totalScore} out of 100 marks.`;
      statTimeSpent.textContent = timeSpentStr;
      statCorrectCount.textContent = `${correctCount} / 45`;
      
      renderDetailedReview();
    }, "result-heading");

    // Persist score to local history
    saveScoreToLocalHistory(totalScore, timeSpentStr, passed);
  }

  function renderDetailedReview() {
    reviewList.innerHTML = "";
    
    questions.forEach((q, idx) => {
      const weight = getQuestionWeight(q);
      const answers = userAnswers[idx] || [];
      const sortedAnswers = [...answers].sort();
      const sortedCorrect = [...q.correctAnswer].sort();
      const isCorrect = JSON.stringify(sortedAnswers) === JSON.stringify(sortedCorrect);
      const isUnanswered = answers.length === 0;
      
      const card = document.createElement("div");
      card.className = `review-item-card ${isUnanswered ? 'unanswered' : (isCorrect ? 'correct' : 'incorrect')}`;
      
      const meta = document.createElement("div");
      meta.className = "review-meta";
      
      const id = document.createElement("span");
      id.className = "review-q-id";
      id.textContent = `Question ${idx + 1} (${q.id}) — Weight: ${weight} Marks`;
      
      const status = document.createElement("span");
      status.className = "review-q-status";
      status.textContent = isUnanswered ? "Unanswered" : (isCorrect ? "Correct" : "Incorrect");
      
      meta.appendChild(id);
      meta.appendChild(status);
      
      const qText = document.createElement("h3");
      qText.className = "review-question-text";
      if (q.correctAnswer.length > 1) {
        qText.innerHTML = `${q.question} <span class="select-all-apply" style="display: block; font-size: 14px; font-weight: 500; color: var(--text-muted); margin-top: 6px;">(Select all that apply)</span>`;
      } else {
        qText.textContent = q.question;
      }
      
      const optionsDiv = document.createElement("div");
      optionsDiv.className = "review-options";
      
      Object.entries(q.options).forEach(([key, val]) => {
        const optionDiv = document.createElement("div");
        optionDiv.className = "review-option";
        
        const isUserSelected = answers.includes(key);
        const isKeyCorrect = q.correctAnswer.includes(key);
        
        // Highlight states
        if (isKeyCorrect) {
          optionDiv.classList.add("correct-choice");
        } else if (isUserSelected && !isKeyCorrect) {
          optionDiv.classList.add("user-incorrect-choice");
        }
        
        const text = document.createElement("span");
        text.textContent = `${key}. ${val}`;
        optionDiv.appendChild(text);
        
        // Indicator icons
        const iconContainer = document.createElement("div");
        iconContainer.className = "review-indicator-icon";
        
        if (isKeyCorrect) {
          iconContainer.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
        } else if (isUserSelected && !isKeyCorrect) {
          iconContainer.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
        }
        
        optionDiv.appendChild(iconContainer);
        optionsDiv.appendChild(optionDiv);
      });
      
      const explanationDiv = document.createElement("div");
      explanationDiv.className = "review-explanation-card";
      explanationDiv.innerHTML = `<strong>Explanation:</strong> ${q.explanation}`;
      
      card.appendChild(meta);
      card.appendChild(qText);
      card.appendChild(optionsDiv);
      card.appendChild(explanationDiv);
      
      reviewList.appendChild(card);
    });
  }

  // --- LOCAL HISTORY PERSISTENCE ---
  function saveScoreToLocalHistory(score, timeSpent, passed) {
    console.log(`[Local History] Saving score locally...`);
    console.log(`Score: ${score}/100 | Time Spent: ${timeSpent} | Result: ${passed ? "PASS" : "FAIL"}`);
    
    try {
      const history = JSON.parse(localStorage.getItem("pl900_mock_history") || "[]");
      history.push({
        timestamp: new Date().toISOString(),
        score: score,
        timeSpent: timeSpent,
        result: passed ? "PASS" : "FAIL"
      });
      localStorage.setItem("pl900_mock_history", JSON.stringify(history));
    } catch (err) {
      console.warn("Could not persist score to localStorage:", err);
    }
  }

  function restartExam() {
    safeNavigate(() => {
      resultView.style.display = "none";
      homeView.style.display = "block";
    }, "home-heading");
  }

  // Run initial loading
  init();
});
