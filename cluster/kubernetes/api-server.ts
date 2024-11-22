import axios from 'axios';
import * as https from 'https';

interface RetryConfig {
    maxRetries: number;
    maxTimeout: number;  // Maximum total timeout in milliseconds
    initialRetryDelay: number;  // Initial delay in milliseconds
}

interface RequestConfig {
    url: string;
    retryConfig?: Partial<RetryConfig>;
}

const defaultRetryConfig: RetryConfig = {
    maxRetries: Number.MAX_VALUE, // Infinite retries, limited with maxTimeout
    maxTimeout: 30000,  // 30 seconds
    initialRetryDelay: 1000,  // 1 second
};

export async function checkApiServerHealth(config: RequestConfig): Promise<any> {
    const retryConfig = { ...defaultRetryConfig, ...config.retryConfig };
    let attemptCount = 0;
    const startTime = Date.now();

    const axiosInstance = axios.create({
        httpsAgent: new https.Agent({
            rejectUnauthorized: false  // Ignore self-signed certificate
        }),
        timeout: 5000,  // 5 second timeout per request
        validateStatus: (status) => status === 401 || (status >= 200 && status < 300),
    });

    while (attemptCount < retryConfig.maxRetries) {
        try {
            const response = await axiosInstance({
                url: config.url,
                method: 'GET',
            });

            return;
        } catch (error) {
            console.log(error);
            attemptCount++;

            // Check if we've exceeded the max total timeout
            if (Date.now() - startTime >= retryConfig.maxTimeout) {
                throw new Error('Maximum total timeout exceeded');
            }

            // If we've used all retries, throw the error
            if (attemptCount === retryConfig.maxRetries) {
                throw error;
            }

            // Calculate delay with exponential backoff
            const delay = Math.min(
                retryConfig.initialRetryDelay * Math.pow(2, attemptCount - 1),
                retryConfig.maxTimeout - (Date.now() - startTime)
            );

            // Log retry attempt (you might want to use proper logging in production)
            console.log(`Retry attempt ${attemptCount} after ${delay}ms delay`);

            // Wait before retrying
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    throw new Error('Max retries exceeded');
}
