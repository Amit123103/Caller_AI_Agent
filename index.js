const express = require('express');
const { OpenAI } = require('openai');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

dotenv.config();

const PORT = process.env.PORT || 3000;
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;
const USER_NAME = process.env.USER_NAME || 'the user';

if (!NVIDIA_API_KEY || NVIDIA_API_KEY === 'your_nvidia_api_key_here') {
  console.error("Missing or invalid NVIDIA_API_KEY in environment variables.");
}

// Initialize NVIDIA/OpenAI Client
const client = new OpenAI({
  apiKey: NVIDIA_API_KEY,
  baseURL: 'https://integrate.api.nvidia.com/v1'
});

const SYSTEM_PROMPT = fs.readFileSync(path.join(process.cwd(), 'system_prompt.txt'), 'utf8');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 1. Initial Greeting and Gather Speech
app.all('/incoming-call', (req, res) => {
  const greeting = `Hi, you've reached ${USER_NAME}'s assistant. How can I help you today?`;
  
  const twiml = `
    <Response>
      <Say voice="Polly.Brian-Neural">${greeting}</Say>
      <Gather input="speech" action="/handle-speech" method="POST" speechTimeout="auto" />
    </Response>
  `;
  res.type('text/xml');
  res.send(twiml);
});

// 2. Handle transcribed speech and call NVIDIA
app.post('/handle-speech', async (req, res) => {
  const callerSpeech = req.body.SpeechResult;
  
  if (!callerSpeech) {
    // If no speech was detected, ask again
    const twiml = `
      <Response>
        <Say voice="Polly.Brian-Neural">I'm sorry, I didn't catch that. Could you please repeat why you are calling?</Say>
        <Gather input="speech" action="/handle-speech" method="POST" speechTimeout="auto" />
      </Response>
    `;
    return res.type('text/xml').send(twiml);
  }

  console.log(`Caller: ${callerSpeech}`);

  try {
    // Call NVIDIA/OpenAI Chat Completions
    const completion = await client.chat.completions.create({
      model: "openai/gpt-oss-20b",
      messages: [
        { role: "system", content: SYSTEM_PROMPT.replace(/\[USER_NAME\]/g, USER_NAME) },
        { role: "user", content: callerSpeech }
      ],
      temperature: 1,
      top_p: 1,
      max_tokens: 4096,
      stream: true
    });

    let aiResponse = "";
    let reasoning = "";

    // Process stream chunks
    for await (const chunk of completion) {
      if (!chunk.choices || chunk.choices.length === 0) continue;
      
      const delta = chunk.choices[0].delta;
      
      // Capture reasoning if available (user snippet mentioned reasoning_content)
      if (delta.reasoning_content) {
        reasoning += delta.reasoning_content;
        process.stdout.write(`[REASONING]: ${delta.reasoning_content}`);
      }
      
      if (delta.content) {
        aiResponse += delta.content;
        process.stdout.write(delta.content);
      }
    }
    console.log("\n");

    // Handle System Actions (Checking for keywords in the response as defined in the prompt)
    // In a more complex setup, we would use function calling, but let's stick to text triggers for now
    // as defined in the user's prompt (CALL_TRANSFER, CALL_END, etc.)
    
    if (aiResponse.includes("CALL_TRANSFER")) {
        const twiml = `
          <Response>
            <Say voice="Polly.Brian-Neural">${aiResponse.replace("CALL_TRANSFER", "").trim()}</Say>
            <Say voice="Polly.Brian-Neural">Let me connect you right away. Please hold.</Say>
            <!-- In a real app, use <Dial> here -->
            <Hangup />
          </Response>
        `;
        return res.type('text/xml').send(twiml);
    }

    if (aiResponse.includes("CALL_END")) {
        const twiml = `
          <Response>
            <Say voice="Polly.Brian-Neural">${aiResponse.replace("CALL_END", "").trim()}</Say>
            <Hangup />
          </Response>
        `;
        return res.type('text/xml').send(twiml);
    }

    // Standard Response and Continue Listening
    const twiml = `
      <Response>
        <Say voice="Polly.Brian-Neural">${aiResponse}</Say>
        <Gather input="speech" action="/handle-speech" method="POST" speechTimeout="auto" />
      </Response>
    `;
    res.type('text/xml');
    res.send(twiml);

  } catch (error) {
    console.error("Error calling NVIDIA API:", error);
    const twiml = `
      <Response>
        <Say voice="Polly.Brian-Neural">I'm having a bit of trouble connecting right now. Let me try that again.</Say>
        <Redirect>/incoming-call</Redirect>
      </Response>
    `;
    res.type('text/xml').send(twiml);
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
