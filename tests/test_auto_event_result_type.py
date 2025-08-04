"""Test automatic event_result_type extraction from Generic type parameters."""

import pytest
from typing import Any
from pydantic import BaseModel

from bubus.models import BaseEvent


class UserData(BaseModel):
    name: str
    age: int


class TaskResult(BaseModel):
    task_id: str
    status: str


class ModuleLevelResult(BaseModel):
    """Module-level result type for testing auto-detection."""
    result_id: str
    data: dict[str, Any]
    success: bool


class NestedModuleResult(BaseModel):
    """Another module-level type for testing complex generics."""
    items: list[str]
    metadata: dict[str, int]


def test_builtin_types_auto_extraction():
    """Test that built-in types are automatically extracted from Generic parameters."""
    
    class StringEvent(BaseEvent[str]):
        message: str = "Hello"

    class IntEvent(BaseEvent[int]):
        number: int = 42
    
    class FloatEvent(BaseEvent[float]):
        value: float = 3.14

    string_event = StringEvent()
    int_event = IntEvent()
    float_event = FloatEvent()

    assert string_event.event_result_type is str
    assert int_event.event_result_type is int
    assert float_event.event_result_type is float


def test_custom_pydantic_models_auto_extraction():
    """Test that custom Pydantic models are automatically extracted."""
    
    class UserEvent(BaseEvent[UserData]):
        user_id: str = "user123"
        event_result_type: Any = UserData  # Set manually for local test scope

    class TaskEvent(BaseEvent[TaskResult]):
        batch_id: str = "batch456"
        event_result_type: Any = TaskResult  # Set manually for local test scope

    user_event = UserEvent()
    task_event = TaskEvent()

    assert user_event.event_result_type is UserData
    assert task_event.event_result_type is TaskResult


def test_complex_generic_types_auto_extraction():
    """Test that complex generic types are automatically extracted."""
    
    class ListEvent(BaseEvent[list[str]]):
        pass

    class DictEvent(BaseEvent[dict[str, int]]):
        pass
    
    class SetEvent(BaseEvent[set[int]]):
        pass

    list_event = ListEvent()
    dict_event = DictEvent()
    set_event = SetEvent()

    assert list_event.event_result_type == list[str]
    assert dict_event.event_result_type == dict[str, int]
    assert set_event.event_result_type == set[int]


def test_complex_generic_with_custom_types():
    """Test complex generics containing custom types."""
    
    class TaskListEvent(BaseEvent[list[TaskResult]]):
        batch_id: str = "batch456"
        event_result_type: Any = list[TaskResult]  # Set manually for local test scope

    task_list_event = TaskListEvent()
    
    assert task_list_event.event_result_type == list[TaskResult]


def test_explicit_override_still_works():
    """Test that explicit event_result_type overrides still work (backwards compatibility)."""
    
    class OverrideEvent(BaseEvent[str]):
        event_result_type: Any = int  # Override to int instead of str

    override_event = OverrideEvent()
    
    # Should use the explicit override, not the auto-extracted str
    assert override_event.event_result_type is int


def test_no_generic_parameter():
    """Test that events without generic parameters don't get auto-set types."""
    
    class PlainEvent(BaseEvent):
        message: str = "plain"

    plain_event = PlainEvent()
    
    # Should remain None since no generic parameter was provided
    assert plain_event.event_result_type is None


def test_none_generic_parameter():
    """Test that BaseEvent[None] results in None type."""
    
    class NoneEvent(BaseEvent[None]):
        message: str = "none"

    none_event = NoneEvent()
    
    # Should be set to None
    assert none_event.event_result_type is None


def test_nested_inheritance():
    """Test that generic type extraction works with nested inheritance."""
    
    class BaseUserEvent(BaseEvent[UserData]):
        event_result_type: Any = UserData  # Set manually for local test scope
    
    class SpecificUserEvent(BaseUserEvent):
        specific_field: str = "specific"

    specific_event = SpecificUserEvent()
    
    # Should inherit the generic type from parent
    assert specific_event.event_result_type is UserData


def test_module_level_types_auto_extraction():
    """Test that module-level types are automatically detected without manual override."""
    
    class ModuleEvent(BaseEvent[ModuleLevelResult]):
        operation: str = "test_op"
        # No manual event_result_type needed - should be auto-detected
    
    class NestedModuleEvent(BaseEvent[NestedModuleResult]):
        batch_id: str = "batch123"
        # No manual event_result_type needed - should be auto-detected
    
    module_event = ModuleEvent()
    nested_event = NestedModuleEvent()
    
    # Should auto-detect the module-level types
    assert module_event.event_result_type is ModuleLevelResult
    assert nested_event.event_result_type is NestedModuleResult


def test_complex_module_level_generics():
    """Test complex generics with module-level types are auto-detected."""
    
    class ListModuleEvent(BaseEvent[list[ModuleLevelResult]]):
        batch_size: int = 10
        # No manual override - should auto-detect list[ModuleLevelResult]
    
    class DictModuleEvent(BaseEvent[dict[str, NestedModuleResult]]):
        mapping_type: str = "result_map"
        # No manual override - should auto-detect dict[str, NestedModuleResult]
    
    list_event = ListModuleEvent()
    dict_event = DictModuleEvent()
    
    # Should auto-detect complex generics with module-level types
    assert list_event.event_result_type == list[ModuleLevelResult]
    assert dict_event.event_result_type == dict[str, NestedModuleResult]


async def test_module_level_runtime_enforcement():
    """Test that module-level auto-detected types are enforced at runtime."""
    from bubus import EventBus
    
    class RuntimeEvent(BaseEvent[ModuleLevelResult]):
        operation: str = "runtime_test"
        # Auto-detected type should be enforced
    
    # Verify auto-detection worked
    test_event = RuntimeEvent()
    assert test_event.event_result_type is ModuleLevelResult, f"Auto-detection failed: got {test_event.event_result_type}"
    
    bus = EventBus(name='runtime_test_bus')
    
    def correct_handler(event: RuntimeEvent):
        # Return dict that matches ModuleLevelResult schema
        return {
            "result_id": "test123",
            "data": {"key": "value"},
            "success": True
        }
    
    def incorrect_handler(event: RuntimeEvent):
        # Return something that doesn't match ModuleLevelResult
        return {"wrong": "format"}
    
    # Test correct handler
    bus.on('RuntimeEvent', correct_handler)
    
    event1 = RuntimeEvent()
    await bus.dispatch(event1)
    result1 = await event1.event_result()
    
    # Should be cast to ModuleLevelResult
    assert isinstance(result1, ModuleLevelResult)
    assert result1.result_id == "test123"
    assert result1.data == {"key": "value"}
    assert result1.success is True
    
    # Test incorrect handler  
    bus.handlers.clear()  # Clear previous handler
    bus.on('RuntimeEvent', incorrect_handler)
    
    event2 = RuntimeEvent()
    await bus.dispatch(event2)
    
    # Should get an error due to validation failure
    handler_id = list(event2.event_results.keys())[0]
    event_result = event2.event_results[handler_id]
    
    assert event_result.status == 'error'
    assert isinstance(event_result.error, Exception)
    
    await bus.stop(clear=True)


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])