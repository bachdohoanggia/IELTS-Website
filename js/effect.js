const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

let interval = null;
const heading = document.querySelector("h1");
const targetText = heading.dataset.value;

function scrambleText() {
  let iteration = 0;

  clearInterval(interval);

  interval = setInterval(() => {
    heading.innerText = targetText
      .split("")
      .map((letter, index) => {
        if (index < iteration) {
          return targetText[index];
        }
        return letters[Math.floor(Math.random() * 26)];
      })
      .join("");

    if (iteration >= targetText.length) {
      clearInterval(interval);
    }

    iteration += 1 / 3;
  }, 30);
}

setInterval(scrambleText, 4000);

scrambleText();
