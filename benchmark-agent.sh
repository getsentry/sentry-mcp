#!/bin/bash

# Benchmark script for comparing direct vs agent mode performance
# Usage: ./benchmark-agent.sh [iterations]

ITERATIONS=${1:-10}
QUERY="what organizations do I have access to?"

echo "=========================================="
echo "MCP Agent Performance Benchmark"
echo "=========================================="
echo "Query: $QUERY"
echo "Iterations: $ITERATIONS"
echo ""

# Arrays to store timings
declare -a direct_times
declare -a agent_times

echo "Running direct mode tests..."
for i in $(seq 1 $ITERATIONS); do
    echo -n "  Run $i/$ITERATIONS... "

    # Run and capture timing (real time in seconds)
    START=$(date +%s.%N)
    pnpm -w run cli "$QUERY" > /dev/null 2>&1
    END=$(date +%s.%N)

    # Calculate duration
    DURATION=$(echo "$END - $START" | bc)
    direct_times+=($DURATION)

    echo "${DURATION}s"
done

echo ""
echo "Running agent mode tests..."
for i in $(seq 1 $ITERATIONS); do
    echo -n "  Run $i/$ITERATIONS... "

    # Run and capture timing
    START=$(date +%s.%N)
    pnpm -w run cli --agent "$QUERY" > /dev/null 2>&1
    END=$(date +%s.%N)

    # Calculate duration
    DURATION=$(echo "$END - $START" | bc)
    agent_times+=($DURATION)

    echo "${DURATION}s"
done

echo ""
echo "=========================================="
echo "Results"
echo "=========================================="

# Calculate statistics for direct mode
direct_sum=0
direct_min=${direct_times[0]}
direct_max=${direct_times[0]}
for time in "${direct_times[@]}"; do
    direct_sum=$(echo "$direct_sum + $time" | bc)
    if (( $(echo "$time < $direct_min" | bc -l) )); then
        direct_min=$time
    fi
    if (( $(echo "$time > $direct_max" | bc -l) )); then
        direct_max=$time
    fi
done
direct_avg=$(echo "scale=2; $direct_sum / $ITERATIONS" | bc)

# Calculate statistics for agent mode
agent_sum=0
agent_min=${agent_times[0]}
agent_max=${agent_times[0]}
for time in "${agent_times[@]}"; do
    agent_sum=$(echo "$agent_sum + $time" | bc)
    if (( $(echo "$time < $agent_min" | bc -l) )); then
        agent_min=$time
    fi
    if (( $(echo "$time > $agent_max" | bc -l) )); then
        agent_max=$time
    fi
done
agent_avg=$(echo "scale=2; $agent_sum / $ITERATIONS" | bc)

# Calculate difference
diff=$(echo "scale=2; $agent_avg - $direct_avg" | bc)
percent=$(echo "scale=1; ($agent_avg - $direct_avg) / $direct_avg * 100" | bc)

echo ""
echo "Direct Mode:"
echo "  Min:     ${direct_min}s"
echo "  Max:     ${direct_max}s"
echo "  Average: ${direct_avg}s"
echo ""
echo "Agent Mode:"
echo "  Min:     ${agent_min}s"
echo "  Max:     ${agent_max}s"
echo "  Average: ${agent_avg}s"
echo ""
echo "Difference:"
if (( $(echo "$diff > 0" | bc -l) )); then
  echo "  +${diff}s (${percent}% slower)"
elif (( $(echo "$diff < 0" | bc -l) )); then
  abs_diff=$(echo "scale=2; -1 * $diff" | bc)
  abs_percent=$(echo "scale=1; -1 * $percent" | bc)
  echo "  -${abs_diff}s (${abs_percent}% faster)"
else
  echo "  No difference (0%)"
fi
echo ""

# Show all individual results
echo "All timings:"
echo "  Direct: ${direct_times[*]}"
echo "  Agent:  ${agent_times[*]}"
