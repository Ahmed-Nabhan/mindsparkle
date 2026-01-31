// Test garbage detection logic
function isGarbageText(text) {
  if (!text || text.length < 100) return true;
  const sample = text.slice(0, 2000);
  let letters = 0, symbols = 0;
  for (let i = 0; i < sample.length; i++) {
    const code = sample.charCodeAt(i);
    if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) letters++;
    else if (code >= 33 && code <= 126 && '.,;:\'"!?()-[]/<> '.indexOf(sample[i]) === -1) symbols++;
  }
  const letterRatio = letters / sample.length;
  const symbolRatio = symbols / sample.length;
  console.log('Letter ratio:', (letterRatio * 100).toFixed(1) + '%');
  console.log('Symbol ratio:', (symbolRatio * 100).toFixed(1) + '%');
  console.log('Threshold: letters >= 30%, symbols <= 30%');
  return letterRatio < 0.3 || symbolRatio > 0.3;
}

// Test with sample from the Penetration Testing PDF
const sample = `Penetration testing
A Hands-On Introduction to Hacking
by Georgia Weidman
San Francisco
Penetration testing. Copyright 2014 by Georgia Weidman.
All rights reserved. No part of this work may be reproduced or transmitted in any form or by any means, electronic or mechanical, including photocopying, recording, or by any information storage or retrieval system, without the prior written permission of the copyright owner and the publisher.
Chapter 0: Penetration Testing Primer
Chapter 1: Setting Up Your Virtual Lab
Chapter 2: Using Kali Linux
Chapter 3: Programming
Chapter 4: Using the Metasploit Framework`;

console.log('=== Penetration Testing PDF Sample ===');
console.log('Sample length:', sample.length);
console.log('Is garbage:', isGarbageText(sample));
